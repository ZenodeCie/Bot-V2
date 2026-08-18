import { reportBotStatus, type HostContext } from "./context.js"
import type { Pm2ProcessInfo } from "./pm2Manager.js"
import type { RealStatusPayload, VmStatsBotEntry } from "./protocol.js"
import { readDiscordRuntime } from "./runtimeReader.js"

const STATS_INTERVAL_MS = 15_000
const REAL_STATUS_INTERVAL_MS = 5_000
const REAL_STATUS_MIN_GAP_MS = 25_000

export class StatusReporter {
  private readonly lastPm2 = new Map<string, string>()
  private readonly lastReady = new Map<string, string>()
  private readonly lastRealPost = new Map<string, number>()
  private statsTimer: NodeJS.Timeout | null = null
  private realTimer: NodeJS.Timeout | null = null
  private running = false

  constructor(private readonly ctx: HostContext) {}

  start(): void {
    if (this.running) return
    this.running = true
    void this.tickStats()
    void this.tickReal()
    this.statsTimer = setInterval(() => {
      void this.tickStats()
    }, STATS_INTERVAL_MS)
    this.realTimer = setInterval(() => {
      void this.tickReal()
    }, REAL_STATUS_INTERVAL_MS)
    this.statsTimer.unref()
    this.realTimer.unref()
  }

  stop(): void {
    this.running = false
    if (this.statsTimer) clearInterval(this.statsTimer)
    if (this.realTimer) clearInterval(this.realTimer)
    this.statsTimer = null
    this.realTimer = null
  }

  private async tickStats(): Promise<void> {
    try {
      const procs = await this.ctx.pm2.listBots()
      await this.emitStatusChanges(procs)

      const visible: VmStatsBotEntry[] = []
      let active = 0
      let error = 0
      let offline = 0
      for (const proc of procs) {
        if (proc.status === "online") {
          visible.push({ bot_id: proc.name, status: "online" })
          active += 1
        } else if (proc.status === "starting") {
          visible.push({ bot_id: proc.name, status: "starting" })
        } else if (proc.status === "error") {
          error += 1
        } else {
          offline += 1
        }
      }

      await this.ctx.rest.postVmStats({
        vm_host: this.ctx.env.vmHost,
        bots: visible,
        stats: {
          total: visible.length,
          active,
          offline,
          error,
        },
      })
    } catch (error) {
      this.ctx.log.warn(`VM stats tick failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async emitStatusChanges(procs: Pm2ProcessInfo[]): Promise<void> {
    const seen = new Set<string>()
    for (const proc of procs) {
      seen.add(proc.name)
      const previous = this.lastPm2.get(proc.name)
      if (previous !== proc.status) {
        this.lastPm2.set(proc.name, proc.status)
        if (previous !== undefined) {
          this.ctx.log.info(`PM2 ${proc.name}: ${previous} → ${proc.status}`)
          await reportBotStatus(this.ctx, proc.name, proc.status)
        }
      }
    }
    for (const [name, status] of this.lastPm2) {
      if (seen.has(name)) continue
      if (status !== "offline") {
        this.lastPm2.set(name, "offline")
        this.ctx.log.info(`PM2 ${name}: ${status} → offline (process gone)`)
        await reportBotStatus(this.ctx, name, "offline")
      }
    }
  }

  private async tickReal(): Promise<void> {
    try {
      const procs = await this.ctx.pm2.listBots()
      const now = Date.now()
      for (const proc of procs) {
        if (proc.status === "offline") continue
        const runtime = await readDiscordRuntime(this.ctx.env, proc.name)
        const readyKey = `${runtime?.ready === true}-${runtime?.readyState ?? "UNKNOWN"}-${runtime?.stale === true}`
        const changed = this.lastReady.get(proc.name) !== readyKey
        const due = now - (this.lastRealPost.get(proc.name) ?? 0) >= REAL_STATUS_MIN_GAP_MS
        if (!changed && !due) continue
        this.lastReady.set(proc.name, readyKey)
        this.lastRealPost.set(proc.name, now)
        await this.postReal(proc, runtime)
      }
    } catch (error) {
      this.ctx.log.warn(`real-status tick failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async postReal(proc: Pm2ProcessInfo, runtime: Awaited<ReturnType<typeof readDiscordRuntime>>): Promise<void> {
    const discordReady = runtime?.ready === true
    const readyState = runtime?.readyState ?? "UNKNOWN"
    const payload: RealStatusPayload = {
      pm2_online: proc.status === "online" || proc.status === "starting",
      discord_ready: discordReady,
      discord_ready_state: readyState,
      really_online: discordReady && readyState === "READY",
      last_status_update: runtime?.updatedAt ?? Date.now(),
      pm2_status: proc.pm2Status,
      memory: proc.memory,
      cpu: proc.cpu,
      uptime: proc.uptime,
      restart_time: proc.restartTime,
      ping: runtime?.ping ?? 0,
      vm: this.ctx.env.vmType,
      vm_host: this.ctx.env.vmHost,
      timestamp: Date.now(),
      guilds: runtime?.guilds ?? 0,
      users: runtime?.users ?? 0,
    }
    try {
      await this.ctx.rest.postRealStatus(proc.name, payload)
    } catch (error) {
      this.ctx.log.warn(`POST real-status ${proc.name} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
