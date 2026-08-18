import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { HostEnv } from "./env.js"

export interface DiscordRuntime {
  ready: boolean
  readyState: string
  ping: number
  guilds: number
  users: number
  updatedAt: number
  stale: boolean
}

const STALE_MS = 30_000

export async function readDiscordRuntime(env: HostEnv, botId: string): Promise<DiscordRuntime | null> {
  const path = join(env.dataDir, botId, "runtime.json")
  if (!existsSync(path)) return null
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"))
    if (!raw || typeof raw !== "object") return null
    const record = raw as Record<string, unknown>
    const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : 0
    const stale = updatedAt <= 0 || Date.now() - updatedAt > STALE_MS
    const ready = record.ready === true && !stale
    return {
      ready,
      readyState: typeof record.readyState === "string" ? record.readyState : stale ? "UNKNOWN" : "UNKNOWN",
      ping: typeof record.ping === "number" ? record.ping : 0,
      guilds: typeof record.guilds === "number" ? record.guilds : 0,
      users: typeof record.users === "number" ? record.users : 0,
      updatedAt,
      stale,
    }
  } catch {
    return null
  }
}
