import { Schema, model } from "mongoose"

export const MAX_TITLE_LENGTH = 256
export const MAX_DESCRIPTION_LENGTH = 4000

export interface RulesConfig {
  guildId: string
  enabled: boolean
  channelId: string | null
  messageId: string | null
  title: string
  description: string
  roleId: string | null
  ignoreBots: boolean
}

export function defaultConfig(guildId: string): RulesConfig {
  return {
    guildId,
    enabled: false,
    channelId: null,
    messageId: null,
    title: "",
    description: "",
    roleId: null,
    ignoreBots: true,
  }
}

const rulesSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    roleId: { type: String, default: null },
    ignoreBots: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export const Rules = model("Rules", rulesSchema, "rules")

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function asStringOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null) return null
  return typeof value === "string" ? value : fallback
}

export function clampTitle(value: string): string {
  return value.trim().slice(0, MAX_TITLE_LENGTH)
}

export function clampDescription(value: string): string {
  return value.trim().slice(0, MAX_DESCRIPTION_LENGTH)
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): RulesConfig {
  const guildId = typeof raw?.guildId === "string" ? raw.guildId : ""
  const defaults = defaultConfig(guildId)
  return {
    guildId,
    enabled: asBoolean(raw?.enabled, defaults.enabled),
    channelId: asStringOrNull(raw?.channelId, defaults.channelId),
    messageId: asStringOrNull(raw?.messageId, defaults.messageId),
    title: clampTitle(asString(raw?.title, defaults.title)),
    description: clampDescription(asString(raw?.description, defaults.description)),
    roleId: asStringOrNull(raw?.roleId, defaults.roleId),
    ignoreBots: asBoolean(raw?.ignoreBots, defaults.ignoreBots),
  }
}

const CONFIG_CACHE_TTL = 5_000
const cache = new Map<string, { config: RulesConfig; ts: number }>()

export function invalidateConfig(guildId: string): void {
  cache.delete(guildId)
}

export async function getConfig(guildId: string): Promise<RulesConfig> {
  const hit = cache.get(guildId)
  if (hit && Date.now() - hit.ts < CONFIG_CACHE_TTL) return hit.config
  const raw = await Rules.findOne({ guildId }).lean()
  const config = normalizeConfig((raw as Record<string, unknown> | null) ?? { guildId })
  cache.set(guildId, { config, ts: Date.now() })
  return config
}

export async function updateConfig(guildId: string, update: Record<string, unknown>): Promise<RulesConfig> {
  await Rules.findOneAndUpdate({ guildId }, update, { upsert: true })
  invalidateConfig(guildId)
  return getConfig(guildId)
}
