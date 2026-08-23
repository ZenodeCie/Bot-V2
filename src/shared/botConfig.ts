export const KNOWN_MODULE_KEYS = [
  "Base",
  "Moderation",
  "Utilities",
  "Giveaway",
  "Levels",
  "Rules",
  "Tickets",
  "Aeroport",
  "Logs",
  "StaffList",
  "Beta",
  "Captcha",
  "Partenariat",
  "ModerationAvancee",
  "Douane",
  "Message-Horaire",
  "InformationPanel",
  "Invitations",
  "FactoryPremium",
  "FactoryManager",
] as const

export type KnownModuleKey = (typeof KNOWN_MODULE_KEYS)[number]

export const APP_EMOJI_KEYS = [
  "cancel",
  "add",
  "settings",
  "power",
  "pin",
  "people",
  "loop",
  "file",
  "cog",
  "check",
] as const

export type AppEmojiName = (typeof APP_EMOJI_KEYS)[number]
export type ApplicationEmojis = Partial<Record<AppEmojiName, string>>

export const DEFAULT_SUPPORT_URL = "https://discord.gg/zenode"

export const DEFAULT_DEVELOPER_IDS = ["1385340488894124235"] as const

const SNOWFLAKE_RE = /^\d{17,22}$/

function normalizeSupportUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_SUPPORT_URL
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith("discord.gg/")) return `https://${trimmed}`
  return trimmed
}

export function resolveSupportUrl(config?: Pick<BotConfig, "urlsupport" | "guildsupport"> | null): string {
  const fromConfig = config?.urlsupport?.trim() || config?.guildsupport?.trim()
  return fromConfig ? normalizeSupportUrl(fromConfig) : DEFAULT_SUPPORT_URL
}

export function parseApplicationEmojis(value: unknown): ApplicationEmojis | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const out: ApplicationEmojis = {}
  for (const key of APP_EMOJI_KEYS) {
    const id = record[key]
    if (typeof id === "string" && SNOWFLAKE_RE.test(id.trim())) out[key] = id.trim()
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Incoming valid IDs win; missing incoming keys keep existing. Absent/empty incoming keeps existing as-is. */
export function mergeApplicationEmojis(
  existing: ApplicationEmojis | undefined,
  incoming: unknown
): ApplicationEmojis | undefined {
  const fromExisting = parseApplicationEmojis(existing) ?? {}
  if (incoming === undefined || incoming === null) {
    return Object.keys(fromExisting).length > 0 ? fromExisting : undefined
  }
  const fromIncoming = parseApplicationEmojis(incoming) ?? {}
  const merged: ApplicationEmojis = { ...fromExisting, ...fromIncoming }
  return Object.keys(merged).length > 0 ? merged : undefined
}

export interface BotConfig {
  bot_id: string
  name?: string
  token?: string
  prefix?: string
  status?: string
  status_customized?: boolean
  color?: string
  urlsupport?: string
  rolesupport?: string
  guildsupport?: string
  channelsupport?: string
  modules?: string[]
  client_id?: string
  owner_zenode_id?: string
  discord_bot_id?: string
  discord_username?: string
  discord_avatar?: string
  max_memory?: number
  vm_host?: string
  application_emojis?: ApplicationEmojis
}

export function isBotConfig(value: unknown): value is BotConfig {
  if (value === null || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.bot_id === "string" && record.bot_id.length > 0
}

export function asBotConfig(value: unknown): BotConfig | null {
  if (!isBotConfig(value)) return null
  const record = value as BotConfig
  const application_emojis = parseApplicationEmojis(record.application_emojis)
  if (application_emojis) return { ...record, application_emojis }
  const { application_emojis: _ignored, ...rest } = record
  return rest
}

export function parseHexColor(value: unknown, fallback: `#${string}` = "#5865f2"): `#${string}` {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed as `#${string}`
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}` as `#${string}`
  return fallback
}

export function defaultMaxMemory(config: BotConfig | null | undefined): number {
  const raw = config?.max_memory
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw)
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw)
  return 200
}
