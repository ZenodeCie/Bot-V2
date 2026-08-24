import { toPm2Name } from "../shared/botId.js"
import { reportBotStatus, type HostContext } from "./context.js"
import { isLiveBotProcess, type Pm2ProcessInfo } from "./pm2Manager.js"
import type { BotLifecycleStatus, HostedBotInfo, RealStatusPayload, VmStatsBotEntry } from "./protocol.js"
import { readDiscordRuntime } from "./runtimeReader.js"
import { getAgentVersionInfo } from "./versionInfo.js"

const STATS_INTERVAL_MS = 30_000
const REAL_STATUS_INTERVAL_MS = 10_000
/** With ~90 bots, 25s gaps ≈ 200+ POST/min and trips Core 429. */
const REAL_STATUS_MIN_GAP_MS = 120_000
/** Cap how many real-status POSTs we send per tick to avoid bursts. */
const REAL_STATUS_MAX_PER_TICK = 6
const ASSIGNED_CACHE_MS = 60_000

function pm2StatusToLifecycle(proc: Pm2ProcessInfo | undefined): BotLifecycleStatus {
  if (!proc || !isLiveBotProcess(proc)) return "offline"
  return proc.status
}

export class StatusReporter {
  private readonly lastPm2 = new Map<string, string>()
  private readonly lastReady = new Map<string, string>()
  private readonly lastRealPost = new Map<string, number>()
  private assignedCache: { at: number; bots: HostedBotInfo[] } | null = null
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

  private async getAssignedBotsCached(): Promise<HostedBotInfo[]> {
    const now = Date.now()
    if (this.assignedCache && now - this.assignedCache.at < ASSIGNED_CACHE_MS) {
      return this.assignedCache.bots
    }
    try {
      const bots = await this.ctx.rest.getAssignedBots()
      this.assignedCache = { at: now, bots }
      return bots
    } catch (error) {
      this.ctx.log.warn(
        `GET assigned bots for stats failed: ${error instanceof Error ? error.message : String(error)}`
      )
      return this.assignedCache?.bots ?? []
    }
  }

  private buildVmStats(procs: Pm2ProcessInfo[], assigned: HostedBotInfo[]): {
    bots: VmStatsBotEntry[]
    stats: { total: number; active: number; offline: number; error: number }
  } {
    const procsByName = new Map(procs.map((proc) => [proc.name, proc]))
    const bots: VmStatsBotEntry[] = []
    const seen = new Set<string>()
    let active = 0
    let offline = 0
    let error = 0

    const pushBot = (botId: string, status: BotLifecycleStatus): void => {
      bots.push({ bot_id: botId, status })
      if (status === "online") active += 1
      else if (status === "error") error += 1
      else if (status === "offline") offline += 1
    }

    for (const bot of assigned) {
      const name = toPm2Name(bot.bot_id)
      if (seen.has(name)) continue
      seen.add(name)
      pushBot(name, pm2StatusToLifecycle(procsByName.get(name)))
    }

    for (const proc of procs) {
      if (!this.ctx.pm2.isBotProcess(proc)) continue
      if (seen.has(proc.name)) continue
      seen.add(proc.name)
      pushBot(proc.name, pm2StatusToLifecycle(proc))
    }

    return {
      bots,
      stats: {
        total: bots.length,
        active,
        offline,
        error,
      },
    }
  }

  private async tickStats(): Promise<void> {
    let procs: Pm2ProcessInfo[] = []
    try {
      procs = await this.ctx.pm2.listBots()
    } catch (error) {
      this.ctx.log.warn(
        `PM2 list failed, reporting all bots offline: ${error instanceof Error ? error.message : String(error)}`
      )
      procs = []
    }

    const liveProcs = procs.filter(isLiveBotProcess)
    await this.emitStatusChanges(liveProcs)

    const assigned = await this.getAssignedBotsCached()
    const { bots, stats } = this.buildVmStats(procs, assigned)
    const versionInfo = getAgentVersionInfo(this.ctx.env.repoRoot)

    try {
      await this.ctx.rest.postVmStats({
        vm_host: this.ctx.env.vmHost,
        bots,
        stats,
        version: versionInfo.version,
        git_commit: versionInfo.git_commit,
        git_branch: versionInfo.git_branch,
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
      const procs = (await this.ctx.pm2.listBots()).filter(isLiveBotProcess)
      const now = Date.now()
      type Candidate = {
        proc: Pm2ProcessInfo
        runtime: Awaited<ReturnType<typeof readDiscordRuntime>>
        readyKey: string
        changed: boolean
      }
      const candidates: Candidate[] = []

      for (const proc of procs) {
        if (proc.status === "offline") continue
        const runtime = await readDiscordRuntime(this.ctx.env, proc.name)
        const readyKey = `${runtime?.ready === true}-${runtime?.readyState ?? "UNKNOWN"}-${runtime?.stale === true}`
        const changed = this.lastReady.get(proc.name) !== readyKey
        const due = now - (this.lastRealPost.get(proc.name) ?? 0) >= REAL_STATUS_MIN_GAP_MS
        if (!changed && !due) continue
        candidates.push({ proc, runtime, readyKey, changed })
      }

      candidates.sort((a, b) => Number(b.changed) - Number(a.changed))
      for (const item of candidates.slice(0, REAL_STATUS_MAX_PER_TICK)) {
        this.lastReady.set(item.proc.name, item.readyKey)
        this.lastRealPost.set(item.proc.name, Date.now())
        await this.postReal(item.proc, item.runtime)
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
