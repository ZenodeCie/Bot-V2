import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { defaultMaxMemory, type BotConfig } from "../shared/botConfig.js"
import { HOST_AGENT_PM2_NAME, assertValidBotId, toPm2Name } from "../shared/botId.js"
import type { HostEnv } from "./env.js"
import type { HostLogger } from "./logger.js"
import type { BotLifecycleStatus, Pm2ProcessStatus } from "./protocol.js"

const execFileAsync = promisify(execFile)

export interface Pm2ProcessInfo {
  name: string
  pmId: number | null
  pid: number
  status: BotLifecycleStatus
  pm2Status: Pm2ProcessStatus
  memory: number
  cpu: number
  uptime: number
  restartTime: number
  script: string
  args: string[]
}

export interface BotLogs {
  stdout: string
  stderr: string
  error: string | null
}

interface Pm2JlistProcess {
  name?: string
  pm_id?: number
  pid?: number
  pm2_env?: {
    status?: string
    restart_time?: number
    pm_uptime?: number
    pm_exec_path?: string
    args?: string[] | string
    pm_cwd?: string
  }
  monit?: {
    memory?: number
    cpu?: number
  }
}

function notFound(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`.toLowerCase()
  return (
    text.includes("not found") ||
    text.includes("doesn't exist") ||
    text.includes("does not exist") ||
    text.includes("process name not found") ||
    text.includes("[error] process or namespace not found")
  )
}

function mapPm2Status(raw: string | undefined): { lifecycle: BotLifecycleStatus; pm2: Pm2ProcessStatus } {
  switch (raw) {
    case "online":
      return { lifecycle: "online", pm2: "online" }
    case "launching":
      return { lifecycle: "starting", pm2: "starting" }
    case "errored":
    case "one-launch-status":
      return { lifecycle: "error", pm2: "errored" }
    default:
      return { lifecycle: "offline", pm2: "stopped" }
  }
}

function asArgs(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value
  if (typeof value === "string" && value.length > 0) return [value]
  return []
}

export class Pm2Manager {
  constructor(
    private readonly env: HostEnv,
    private readonly log: HostLogger
  ) {}

  async version(): Promise<string> {
    const { stdout } = await this.exec(["-v"], 8_000)
    return stdout.trim()
  }

  pm2Name(botId: string): string {
    return toPm2Name(assertValidBotId(botId))
  }

  async list(): Promise<Pm2ProcessInfo[]> {
    const { stdout } = await this.exec(["jlist"], 15_000)
    const jsonStart = stdout.indexOf("[")
    if (jsonStart === -1) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(stdout.slice(jsonStart)) as unknown
    } catch {
      this.log.warn("Failed to parse pm2 jlist")
      return []
    }
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => this.normalize(item as Pm2JlistProcess))
      .filter((item): item is Pm2ProcessInfo => item !== null)
  }

  async listBots(): Promise<Pm2ProcessInfo[]> {
    const all = await this.list()
    return all.filter((proc) => this.isBotProcess(proc))
  }

  isBotProcess(proc: Pm2ProcessInfo): boolean {
    if (proc.name === HOST_AGENT_PM2_NAME) return false
    if (proc.script.includes("host/index")) return false
    const looksLikeBotScript = proc.script.includes("bot/index") || proc.script === this.env.botEntry
    const hasConfigArg = proc.args.includes("--config") || proc.args.some((arg) => arg.includes("/configs/"))
    return looksLikeBotScript || hasConfigArg
  }

  async describe(botId: string): Promise<Pm2ProcessInfo | null> {
    const name = this.pm2Name(botId)
    const bots = await this.listBots()
    return bots.find((proc) => proc.name === name) ?? null
  }

  async start(botId: string, configPath: string, config: BotConfig | null): Promise<void> {
    const name = this.pm2Name(botId)
    const existing = await this.describe(botId)
    if (existing?.status === "online" || existing?.status === "starting") {
      this.log.info(`start ${botId}: already ${existing.status}, keeping single process`)
      return
    }
    if (existing) await this.delete(botId)

    const maxMemory = defaultMaxMemory(config)
    const args = [
      "start",
      this.env.botEntry,
      "--force",
      "--name",
      name,
      "--cwd",
      this.env.repoRoot,
      "--max-memory-restart",
      `${maxMemory}M`,
      "--",
      "--config",
      configPath,
    ]
    this.log.info(`pm2 start ${name} max_memory=${maxMemory}M`)
    await this.exec(args, 20_000)
  }

  async stop(botId: string): Promise<void> {
    const name = this.pm2Name(botId)
    try {
      await this.exec(["stop", name], 15_000)
    } catch (error) {
      if (!this.isNotFoundError(error)) throw error
    }
    await this.delete(botId)
  }

  async delete(botId: string): Promise<void> {
    const name = this.pm2Name(botId)
    try {
      await this.exec(["delete", name], 15_000)
    } catch (error) {
      if (!this.isNotFoundError(error)) throw error
    }
  }

  async restart(botId: string, configPath: string, config: BotConfig | null): Promise<void> {
    await this.delete(botId)
    await this.start(botId, configPath, config)
  }

  async logs(botId: string, lines: number): Promise<BotLogs> {
    const name = this.pm2Name(botId)
    const clamped = Math.min(500, Math.max(1, Math.floor(lines)))
    const existing = await this.describe(botId)
    if (!existing) {
      return { stdout: "", stderr: "", error: null }
    }
    const [stdoutRes, stderrRes] = await Promise.all([
      this.execLogs(name, clamped, "out"),
      this.execLogs(name, clamped, "err"),
    ])
    return {
      stdout: stdoutRes.stdout,
      stderr: stderrRes.stdout || stderrRes.stderr,
      error: null,
    }
  }

  private async execLogs(name: string, lines: number, stream: "out" | "err"): Promise<{ stdout: string; stderr: string }> {
    try {
      return await this.exec(["logs", name, "--lines", String(lines), "--nostream", "--raw", `--${stream}`], 12_000)
    } catch (error) {
      if (stream === "out") {
        try {
          return await this.exec(["logs", name, "--lines", String(lines), "--nostream"], 12_000)
        } catch (fallbackError) {
          if (this.isNotFoundError(fallbackError)) return { stdout: "", stderr: "" }
          throw fallbackError
        }
      }
      if (this.isNotFoundError(error)) return { stdout: "", stderr: "" }
      return { stdout: "", stderr: error instanceof Error ? error.message : String(error) }
    }
  }

  private normalize(item: Pm2JlistProcess): Pm2ProcessInfo | null {
    const name = item.name
    if (!name) return null
    const mapped = mapPm2Status(item.pm2_env?.status)
    const uptimeStart = item.pm2_env?.pm_uptime ?? 0
    const uptime = uptimeStart > 0 ? Math.max(0, Date.now() - uptimeStart) : 0
    return {
      name,
      pmId: typeof item.pm_id === "number" ? item.pm_id : null,
      pid: typeof item.pid === "number" ? item.pid : 0,
      status: mapped.lifecycle,
      pm2Status: mapped.pm2,
      memory: item.monit?.memory ?? 0,
      cpu: item.monit?.cpu ?? 0,
      uptime,
      restartTime: item.pm2_env?.restart_time ?? 0,
      script: item.pm2_env?.pm_exec_path ?? "",
      args: asArgs(item.pm2_env?.args),
    }
  }

  private isNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false
    const err = error as { stderr?: string; stdout?: string; message?: string }
    return notFound(err.stderr ?? "", `${err.stdout ?? ""}\n${err.message ?? ""}`)
  }

  private async exec(args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync("pm2", args, {
        timeout,
        maxBuffer: 12 * 1024 * 1024,
        encoding: "utf8",
        env: process.env,
      })
      return { stdout: stdout ?? "", stderr: stderr ?? "" }
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string }
      const wrapped = new Error(err.stderr?.trim() || err.message || "pm2 command failed")
      Object.assign(wrapped, { stdout: err.stdout ?? "", stderr: err.stderr ?? "" })
      throw wrapped
    }
  }
}
