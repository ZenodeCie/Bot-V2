import WebSocket from "ws"
import type { RawData } from "ws"
import type { HostEnv } from "./env.js"
import type { HostLogger } from "./logger.js"
import { parseInboundMessage, type InboundMessage, type OutboundMessage } from "./protocol.js"

function rawDataToString(data: RawData): string {
  if (typeof data === "string") return data
  if (Buffer.isBuffer(data)) return data.toString("utf8")
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
  return Buffer.from(data).toString("utf8")
}

const PING_INTERVAL_MS = 25_000
/** Sans aucun message ni pong pendant ce délai, la connexion est considérée comme morte et recréée. */
const DEAD_CONNECTION_MS = 90_000
const MAX_BACKOFF_MS = 30_000

export type MessageHandler = (message: InboundMessage) => void | Promise<void>

export class CoreWsClient {
  private socket: WebSocket | null = null
  private pingTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private attempt = 0
  private lastActivity = Date.now()
  private stopped = false
  private handler: MessageHandler | null = null

  constructor(
    private readonly env: HostEnv,
    private readonly log: HostLogger
  ) {}

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    if (this.socket) {
      this.socket.removeAllListeners()
      try {
        this.socket.close()
      } catch {
        /* ignore */
      }
      this.socket = null
    }
  }

  send(message: OutboundMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    const payload = { ...message, vm_host: this.env.vmHost }
    this.socket.send(JSON.stringify(payload))
    return true
  }

  private wsUrl(): string {
    const base = this.env.coreWsUrl
    const url = new URL(base)
    // La clé est envoyée dans le header X-API-Key. Elle reste aussi dans l'URL par compatibilité avec les
    // Core qui ne lisent que la query string : mettre CORE_WS_KEY_IN_QUERY=false dès que le Core accepte le header
    // (une clé dans l'URL finit dans les logs des proxys).
    if (process.env.CORE_WS_KEY_IN_QUERY?.trim().toLowerCase() !== "false") {
      url.searchParams.set("apiKey", this.env.apiKey)
    }
    url.searchParams.set("vmHost", this.env.vmHost)
    return url.toString()
  }

  private connect(): void {
    if (this.stopped) return
    this.clearReconnect()
    const url = this.wsUrl()
    this.log.info(`Connecting WS ${this.env.coreWsUrl} vmHost=${this.env.vmHost}`)
    const socket = new WebSocket(url, { headers: { "X-API-Key": this.env.apiKey } })
    this.socket = socket

    socket.on("open", () => {
      this.attempt = 0
      this.lastActivity = Date.now()
      this.log.info("WS connected")
      this.send({ type: "ping", vm_host: this.env.vmHost })
      this.startPing()
    })

    socket.on("pong", () => {
      this.lastActivity = Date.now()
    })

    socket.on("message", (data) => {
      this.lastActivity = Date.now()
      const text = rawDataToString(data)
      let raw: unknown
      try {
        raw = JSON.parse(text) as unknown
      } catch {
        this.log.warn(`Ignoring non-JSON WS message: ${text.slice(0, 200)}`)
        return
      }
      const message = parseInboundMessage(raw)
      void this.dispatch(message)
    })

    socket.on("close", (code, reason) => {
      this.log.warn(`WS closed code=${code} reason=${reason.toString() || "none"}`)
      this.clearPing()
      if (this.socket === socket) this.socket = null
      this.scheduleReconnect()
    })

    socket.on("error", (error) => {
      this.log.error(`WS error: ${error.message}`)
    })
  }

  private async dispatch(message: InboundMessage): Promise<void> {
    try {
      await this.handler?.(message)
    } catch (error) {
      this.log.error(`WS handler failed (${message.type}):`, error)
    }
  }

  private startPing(): void {
    this.clearPing()
    this.pingTimer = setInterval(() => {
      const socket = this.socket
      if (socket && Date.now() - this.lastActivity > DEAD_CONNECTION_MS) {
        this.log.warn(`WS silent for ${Math.round((Date.now() - this.lastActivity) / 1000)}s — terminating dead connection`)
        socket.terminate()
        return
      }
      this.send({ type: "ping", vm_host: this.env.vmHost })
      try {
        socket?.ping()
      } catch {
        /* socket en cours de fermeture */
      }
    }, PING_INTERVAL_MS)
    this.pingTimer.unref()
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    const delay = Math.min(1000 * 2 ** this.attempt, MAX_BACKOFF_MS)
    this.attempt += 1
    this.log.info(`WS reconnect in ${delay}ms (attempt ${this.attempt})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
    this.reconnectTimer.unref()
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private clearTimers(): void {
    this.clearPing()
    this.clearReconnect()
  }
}
