import { resolve } from "node:path"
import { HOST_AGENT_PM2_NAME } from "../shared/botId.js"

export interface HostEnv {
  coreApiUrl: string
  coreWsUrl: string
  apiKey: string
  vmHost: string
  vmType: string
  configsDir: string
  dataDir: string
  botEntry: string
  repoRoot: string
  autoStartAssigned: boolean
  healthPort: number | null
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

function required(name: string, ...aliases: string[]): string {
  const value = firstEnv(name, ...aliases)
  if (!value) {
    const listed = [name, ...aliases].join(" / ")
    throw new Error(`Missing required environment variable ${listed}`)
  }
  return value
}

function optional(name: string, fallback: string, ...aliases: string[]): string {
  return firstEnv(name, ...aliases) ?? fallback
}

function deriveWsUrl(apiUrl: string): string {
  const url = new URL(apiUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/ws"
  url.search = ""
  url.hash = ""
  return url.toString()
}

export function loadHostEnv(): HostEnv {
  const repoRoot = optional("REPO_ROOT", resolve(import.meta.dirname, "../.."))
  const healthRaw = process.env.HOST_HEALTH_PORT?.trim()
  const healthPort = healthRaw && /^\d+$/.test(healthRaw) ? Number(healthRaw) : null
  const coreApiUrl = required("CORE_API_URL", "API_GATEWAY_URL").replace(/\/$/, "")

  const env: HostEnv = {
    coreApiUrl,
    coreWsUrl: optional("CORE_WS_URL", deriveWsUrl(coreApiUrl)),
    apiKey: required("API_KEY", "API_KEY_VM_BOTS_FREE", "API_KEY_VM_BOTS_PREMIUM"),
    vmHost: required("VM_HOST"),
    vmType: optional("VM_TYPE", "vm-bots-free"),
    configsDir: resolve(repoRoot, optional("CONFIGS_DIR", "./configs", "CONFIGS_PATH")),
    dataDir: resolve(repoRoot, optional("DATA_DIR", "./data")),
    botEntry: resolve(repoRoot, optional("BOT_ENTRY", "dist/bot/index.js")),
    repoRoot,
    autoStartAssigned: optional("AUTO_START_ASSIGNED", "false") === "true",
    healthPort,
  }

  if (!env.vmHost) throw new Error("VM_HOST must be a non-empty unique machine id")
  return env
}

export { HOST_AGENT_PM2_NAME }
