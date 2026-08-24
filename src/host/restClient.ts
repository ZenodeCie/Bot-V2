import { extractBotRecord, extractHostedBots, type BotRestStatus, type HostedBotInfo, type RealStatusPayload, type VmStatsPayload } from "./protocol.js"
import { toPm2Name } from "../shared/botId.js"
import type { HostEnv } from "./env.js"
import type { HostLogger } from "./logger.js"

const MINUTE_MS = 60_000
/** Soft client-side cap; Core often enforces a lower limit and returns 429. */
const DEFAULT_MAX_PER_MINUTE = 45
const RATE_LIMIT_BACKOFF_MS = 30_000

class TokenBucket {
  private stamps: number[] = []
  private pausedUntil = 0

  constructor(private readonly maxPerMinute: number) {}

  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms)
  }

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now()
      if (now < this.pausedUntil) {
        await new Promise((resolve) => setTimeout(resolve, this.pausedUntil - now + 5))
        continue
      }
      this.stamps = this.stamps.filter((stamp) => now - stamp < MINUTE_MS)
      if (this.stamps.length < this.maxPerMinute) {
        this.stamps.push(Date.now())
        return
      }
      const wait = MINUTE_MS - (now - this.stamps[0]) + 20
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

export class CoreRestClient {
  private readonly limiter = new TokenBucket(DEFAULT_MAX_PER_MINUTE)

  constructor(
    private readonly env: HostEnv,
    private readonly log: HostLogger
  ) {}

  async health(): Promise<boolean> {
    try {
      const res = await this.request("/health", { method: "GET" }, { useLimiter: false, timeoutMs: 8_000 })
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
    await this.request(
      `/api/v1/bots/${encodeURIComponent(botId)}/status`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      { useLimiter: false, timeoutMs: 8_000 }
    )
  }

  async getAssignedBots(): Promise<HostedBotInfo[]> {
    const res = await this.request(`/api/v1/bots/vm/${encodeURIComponent(this.env.vmHost)}`, { method: "GET" })
    if (!res.ok) throw new Error(`GET /bots/vm/${this.env.vmHost} → ${res.status}`)
    const body: unknown = await this.readJson(res)
    return extractHostedBots(body)
  }

  async getBot(botId: string, options?: { useLimiter?: boolean }): Promise<HostedBotInfo | null> {
    const res = await this.request(
      `/api/v1/bots/${encodeURIComponent(botId)}`,
      { method: "GET" },
      { useLimiter: options?.useLimiter !== false, timeoutMs: 8_000, allowNotFound: true }
    )
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GET /bots/${botId} → ${res.status}`)
    const body: unknown = await this.readJson(res)
    return extractBotRecord(body, botId)
  }

  /**
   * Avoid starting a bot that Core already considers live on another VM.
   * Uses GET /bots/:id (the old /bots/hosted route is not implemented on Core
   * and is matched as bot_id "hosted" → 404 "Bot non trouvé").
   */
  async isHostedElsewhere(botId: string): Promise<{ elsewhere: boolean; vmHost?: string }> {
    try {
      // Bypass the reporter queue so start/stop are not stalled by real-status traffic.
      const match = await this.getBot(botId, { useLimiter: false })
      if (!match) return { elsewhere: false }
      const running = !match.status || ["online", "starting", "ready"].includes(match.status.toLowerCase())
      if (match.vm_host && match.vm_host !== this.env.vmHost && running) {
        return { elsewhere: true, vmHost: match.vm_host }
      }
      return { elsewhere: false, vmHost: match.vm_host }
    } catch (error) {
      this.log.warn(
        `Duplicate-host check for ${toPm2Name(botId)} failed, allowing local start: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      return { elsewhere: false }
    }
  }

  private async request(
    path: string,
    init: RequestInit,
    options: { useLimiter?: boolean; timeoutMs?: number; allowNotFound?: boolean } = {}
  ): Promise<Response> {
    const useLimiter = options.useLimiter !== false
    const timeoutMs = options.timeoutMs ?? 12_000
    const allowNotFound = options.allowNotFound === true

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

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"))
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RATE_LIMIT_BACKOFF_MS
      this.limiter.pause(backoff)
      const text = await res.text().catch(() => "")
      throw new Error(`REST ${init.method ?? "GET"} ${path} → 429 ${text.slice(0, 300)}`)
    }

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
