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
}

export function isBotConfig(value: unknown): value is BotConfig {
  if (value === null || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.bot_id === "string" && record.bot_id.length > 0
}

export function asBotConfig(value: unknown): BotConfig | null {
  if (!isBotConfig(value)) return null
  return value
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
