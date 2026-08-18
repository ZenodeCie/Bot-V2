import { extractBotRecord, extractHostedBots, type BotRestStatus, type HostedBotInfo, type RealStatusPayload, type VmStatsPayload } from "./protocol.js"
import { toPm2Name } from "../shared/botId.js"
import type { HostEnv } from "./env.js"
import type { HostLogger } from "./logger.js"

const MINUTE_MS = 60_000

class TokenBucket {
  private stamps: number[] = []

  constructor(private readonly maxPerMinute: number) {}

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now()
      this.stamps = this.stamps.filter((stamp) => now - stamp < MINUTE_MS)
      if (this.stamps.length < this.maxPerMinute) {
        this.stamps.push(now)
        return
      }
      const wait = MINUTE_MS - (now - this.stamps[0]) + 20
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

export class CoreRestClient {
  private readonly limiter = new TokenBucket(90)

  constructor(
    private readonly env: HostEnv,
    private readonly log: HostLogger
  ) {}

  async health(): Promise<boolean> {
    try {
      const res = await this.request("/health", { method: "GET" }, false, 8_000)
      return res.ok
    } catch (error) {
      this.log.warn(`GET /health failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  async postVmStats(payload: VmStatsPayload): Promise<void> {
    await this.request("/api/v1/bots/vms/stats", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async postRealStatus(botId: string, payload: RealStatusPayload): Promise<void> {
    await this.request(`/api/v1/bots/${encodeURIComponent(botId)}/real-status`, {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async postStatus(botId: string, status: BotRestStatus): Promise<void> {
    const payload = { status, vm_host: this.env.vmHost }
    await this.request(`/api/v1/bots/${encodeURIComponent(botId)}/status`, {
      method: "POST",
      body: JSON.stringify(payload),
    })
  }

  async getAssignedBots(): Promise<HostedBotInfo[]> {
    const res = await this.request(`/api/v1/bots/vm/${encodeURIComponent(this.env.vmHost)}`, { method: "GET" })
    if (!res.ok) throw new Error(`GET /bots/vm/${this.env.vmHost} → ${res.status}`)
    const body: unknown = await this.readJson(res)
    return extractHostedBots(body)
  }

  async getHostedBots(): Promise<HostedBotInfo[]> {
    const res = await this.request("/api/v1/bots/hosted", { method: "GET" })
    if (!res.ok) throw new Error(`GET /bots/hosted → ${res.status}`)
    const body: unknown = await this.readJson(res)
    return extractHostedBots(body)
  }

  async getBot(botId: string): Promise<HostedBotInfo | null> {
    const res = await this.request(`/api/v1/bots/${encodeURIComponent(botId)}`, { method: "GET" }, true, 12_000, true)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GET /bots/${botId} → ${res.status}`)
    const body: unknown = await this.readJson(res)
    return extractBotRecord(body, botId)
  }

  async isHostedElsewhere(botId: string): Promise<{ elsewhere: boolean; vmHost?: string }> {
    try {
      const hosted = await this.getHostedBots()
      const match = hosted.find((bot) => toPm2Name(bot.bot_id) === toPm2Name(botId))
      if (!match) return { elsewhere: false }
      const running = !match.status || ["online", "starting", "ready"].includes(match.status.toLowerCase())
      if (match.vm_host && match.vm_host !== this.env.vmHost && running) {
        return { elsewhere: true, vmHost: match.vm_host }
      }
      return { elsewhere: false, vmHost: match.vm_host }
    } catch (error) {
      this.log.warn(`GET /hosted failed, allowing local start check to continue: ${error instanceof Error ? error.message : String(error)}`)
      return { elsewhere: false }
    }
  }

  private async request(
    path: string,
    init: RequestInit,
    useLimiter = true,
    timeoutMs = 12_000,
    allowNotFound = false
  ): Promise<Response> {
    if (useLimiter) await this.limiter.take()
    const url = `${this.env.coreApiUrl}${path}`
    const headers = new Headers(init.headers)
    headers.set("X-API-Key", this.env.apiKey)
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
    const res = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok && !(allowNotFound && res.status === 404)) {
      const text = await res.text().catch(() => "")
      throw new Error(`REST ${init.method ?? "GET"} ${path} → ${res.status} ${text.slice(0, 300)}`)
    }
    return res
  }

  private async readJson(res: Response): Promise<unknown> {
    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }
}
