import { mkdir, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Status, type Client } from "discord.js"

export interface RuntimeSnapshot {
  ready: boolean
  readyState: string
  ping: number
  guilds: number
  users: number
  updatedAt: number
}

export function mapWsStatus(status: number): string {
  switch (status) {
    case Status.Ready:
      return "READY"
    case Status.Connecting:
      return "CONNECTING"
    case Status.Reconnecting:
      return "CONNECTING"
    case Status.Idle:
      return "IDLE"
    case Status.Nearly:
      return "NEARLY"
    case Status.Disconnected:
      return "DISCONNECTED"
    case Status.WaitingForGuilds:
      return "WAITING_FOR_GUILDS"
    case Status.Identifying:
      return "IDENTIFYING"
    case Status.Resuming:
      return "RESUMING"
    default:
      return "UNKNOWN"
  }
}

export function snapshotFromClient(client: Client, readyOverride?: boolean): RuntimeSnapshot {
  const wsStatus = client.ws.status
  const ready = readyOverride ?? (client.isReady() && wsStatus === Status.Ready)
  const guilds = client.guilds.cache.size
  const users = client.guilds.cache.reduce((sum, guild) => sum + guild.memberCount, 0)
  return {
    ready,
    readyState: mapWsStatus(wsStatus),
    ping: Number.isFinite(client.ws.ping) ? client.ws.ping : 0,
    guilds,
    users,
    updatedAt: Date.now(),
  }
}

export async function writeRuntimeFile(dataDir: string, snapshot: RuntimeSnapshot): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  const target = join(dataDir, "runtime.json")
  const temp = join(dataDir, "runtime.json.tmp")
  const payload = `${JSON.stringify(snapshot)}\n`
  await writeFile(temp, payload, { encoding: "utf8", mode: 0o600 })
  await rename(temp, target)
}

export function startHeartbeat(client: Client, dataDir: string, intervalMs = 5_000): () => void {
  let stopped = false
  const tick = () => {
    if (stopped) return
    void writeRuntimeFile(dataDir, snapshotFromClient(client)).catch((error: unknown) => {
      console.error("Failed to write runtime heartbeat:", error)
    })
  }
  tick()
  const timer = setInterval(tick, intervalMs)
  timer.unref()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
