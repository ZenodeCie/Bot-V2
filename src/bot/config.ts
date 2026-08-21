import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { config as loadDotenv } from "dotenv"
import { parseHexColor, KNOWN_MODULE_KEYS, type BotConfig } from "../shared/botConfig.js"

loadDotenv()

function argValue(name: string): string | undefined {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  if (index !== -1) return process.argv[index + 1]
  return undefined
}

function resolveConfigPath(): string {
  const fromArg = argValue("--config")
  const fromEnv = process.env.BOT_CONFIG_PATH
  const path = fromArg ?? fromEnv
  if (!path) {
    console.error("Missing --config /path/to/{bot_id}.json (or BOT_CONFIG_PATH).")
    process.exit(1)
  }
  return resolve(path)
}

function loadBotJson(path: string): BotConfig {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown
  } catch (error) {
    console.error(`Failed to read bot config at ${path}:`, error)
    process.exit(1)
  }
  if (!raw || typeof raw !== "object") {
    console.error(`Invalid bot config JSON at ${path}`)
    process.exit(1)
  }
  const record = raw as Record<string, unknown>
  const botId = typeof record.bot_id === "string" ? record.bot_id : ""
  const token = typeof record.token === "string" ? record.token.trim() : ""
  if (!botId) {
    console.error(`bot_id missing from ${path}`)
    process.exit(1)
  }
  if (!token) {
    console.error(`Invalid Discord token in ${path} (unauthorized): token missing.`)
    process.exit(1)
  }
  return { ...(record as unknown as BotConfig), bot_id: botId, token }
}

function loadStandaloneBot(): BotConfig {
  const token = (process.env.BOT_TOKEN ?? "").trim()
  if (!token) {
    console.error("Missing BOT_TOKEN in .env (standalone mode).")
    process.exit(1)
  }
  let clientId = ""
  try {
    clientId = Buffer.from(token.split(".")[0] ?? "", "base64").toString("utf8")
  } catch {
    /* ignore */
  }
  if (!/^\d{5,22}$/.test(clientId)) clientId = ""
  const modules = (process.env.MODULES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return {
    bot_id: process.env.BOT_ID?.trim() || clientId || "standalone",
    name: process.env.BOT_NAME?.trim() || "Standalone",
    token,
    prefix: process.env.PREFIX?.trim() || undefined,
    status: process.env.BOT_STATUS?.trim() || undefined,
    color: process.env.BOT_COLOR?.trim() || undefined,
    modules: modules.length > 0 ? modules : [...KNOWN_MODULE_KEYS],
    client_id: clientId || undefined,
  }
}

function collectOwnerIds(bot: BotConfig): string[] {
  const ids = new Set<string>()
  if (bot.client_id && /^\d{5,22}$/.test(bot.client_id)) ids.add(bot.client_id)
  if (process.env.OWNER_ID) {
    for (const id of process.env.OWNER_ID.split(",")) {
      const trimmed = id.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids]
}

const alone = process.argv.includes("--alone") || process.env.STANDALONE === "1"
const configPath = alone ? "" : resolveConfigPath()
const bot = alone ? loadStandaloneBot() : loadBotJson(configPath)

const prefix = typeof bot.prefix === "string" && bot.prefix.length > 0 ? bot.prefix : "!"
const color = parseHexColor(bot.color)

export const colors: Record<string, `#${string}` | null> = {
  red: "#E82C20",
  yel: "#F4E00B",
  orng: "#F47C0B",
  prime: color,
}

const repoRoot = process.env.REPO_ROOT ?? process.cwd()
const dataRoot = process.env.DATA_DIR ?? resolve(repoRoot, "data")

export const botRuntime = {
  configPath: configPath || null,
  botId: bot.bot_id,
  name: bot.name ?? bot.bot_id,
  token: bot.token as string,
  prefix,
  status: typeof bot.status === "string" && bot.status.length > 0 ? bot.status : "En ligne",
  color,
  modules: Array.isArray(bot.modules) ? bot.modules.filter((item): item is string => typeof item === "string") : ["Base"],
  ownerId: collectOwnerIds(bot),
  mongodbUri: process.env.MONGODB_URI ?? "",
  dataDir: resolve(dataRoot, bot.bot_id),
  raw: bot,
}

const config = {
  token: botRuntime.token,
  mongodbUri: botRuntime.mongodbUri,
  prefix: botRuntime.prefix,
  colors,
  ownerId: botRuntime.ownerId,
  botId: botRuntime.botId,
  dataDir: botRuntime.dataDir,
}

export default config
