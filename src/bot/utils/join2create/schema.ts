import { Schema, model } from "mongoose"
import { applyBotScope, uniqueBotGuildIndex } from "../mongoScope.js"

export const MAX_CHANNEL_NAME_LENGTH = 100
export const MAX_PATTERN_LENGTH = 100
export const MAX_USER_LIMIT = 99
export const DEFAULT_CHANNEL_PATTERN = "{memberName}'s Channel"
export const EMPTY_GRACE_MS = 15_000

export interface J2CConfig {
  guildId: string
  enabled: boolean
  sourceChannelId: string | null
  categoryId: string | null
  channelNamePattern: string
  userLimit: number
  ignoreBots: boolean
  counter: number
}

export interface J2CChannelRecord {
  guildId: string
  sourceChannelId: string
  channelId: string
  textChannelId: string | null
  panelMessageId: string | null
  ownerId: string
  coOwnerIds: string[]
  allowedUserIds: string[]
  blacklistUserIds: string[]
  allowedRoleIds: string[]
  blacklistRoleIds: string[]
  number: number
  createdAt: number
  deletedAt: number | null
  locked: boolean
  hidden: boolean
  serverMuteAll: boolean
  serverDeafenAll: boolean
}

export function defaultConfig(guildId: string): J2CConfig {
  return {
    guildId,
    enabled: false,
    sourceChannelId: null,
    categoryId: null,
    channelNamePattern: DEFAULT_CHANNEL_PATTERN,
    userLimit: 0,
    ignoreBots: true,
    counter: 0,
  }
}

const j2cConfigSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: false },
    sourceChannelId: { type: String, default: null },
    categoryId: { type: String, default: null },
    channelNamePattern: { type: String, default: DEFAULT_CHANNEL_PATTERN },
    userLimit: { type: Number, default: 0 },
    ignoreBots: { type: Boolean, default: true },
    counter: { type: Number, default: 0 },
  },
  { timestamps: true }
)

applyBotScope(j2cConfigSchema)
uniqueBotGuildIndex(j2cConfigSchema)

export const J2CConfigs = model("J2CConfigs", j2cConfigSchema, "join2create")

const j2cChannelRecordSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    sourceChannelId: { type: String, default: null },
    channelId: { type: String, required: true, unique: true, index: true },
    textChannelId: { type: String, default: null },
    panelMessageId: { type: String, default: null },
    ownerId: { type: String, required: true, index: true },
    coOwnerIds: { type: [String], default: [] },
    allowedUserIds: { type: [String], default: [] },
    blacklistUserIds: { type: [String], default: [] },
    allowedRoleIds: { type: [String], default: [] },
    blacklistRoleIds: { type: [String], default: [] },
    number: { type: Number, required: true },
    createdAt: { type: Number, required: true },
    deletedAt: { type: Number, default: null },
    locked: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },
    serverMuteAll: { type: Boolean, default: false },
    serverDeafenAll: { type: Boolean, default: false },
  },
  { timestamps: true }
)

applyBotScope(j2cChannelRecordSchema)

export const J2CChannelRecords = model("J2CChannelRecords", j2cChannelRecordSchema, "join2create_channels")

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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === "string"))].slice(0, 25)
}

function clampNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.min(Math.floor(value), max)
  if (typeof value === "string" && /^\d+$/.test(value)) return Math.min(Number(value), max)
  return fallback
}

function clampText(value: string, max: number): string {
  return value.trim().slice(0, max)
}

export function clampPattern(value: string): string {
  return clampText(value, MAX_PATTERN_LENGTH)
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): J2CConfig {
  const guildId = typeof raw?.guildId === "string" ? raw.guildId : ""
  const defaults = defaultConfig(guildId)
  return {
    guildId,
    enabled: asBoolean(raw?.enabled, defaults.enabled),
    sourceChannelId: asStringOrNull(raw?.sourceChannelId, defaults.sourceChannelId),
    categoryId: asStringOrNull(raw?.categoryId, defaults.categoryId),
    channelNamePattern: clampPattern(asString(raw?.channelNamePattern, defaults.channelNamePattern)) || DEFAULT_CHANNEL_PATTERN,
    userLimit: clampNumber(raw?.userLimit, defaults.userLimit, MAX_USER_LIMIT),
    ignoreBots: asBoolean(raw?.ignoreBots, defaults.ignoreBots),
    counter:
      typeof raw?.counter === "number" && Number.isFinite(raw.counter) && raw.counter > 0 ? Math.floor(raw.counter) : defaults.counter,
  }
}

export function mapRecord(raw: Record<string, unknown>): J2CChannelRecord {
  return {
    guildId: String(raw.guildId),
    sourceChannelId: typeof raw.sourceChannelId === "string" ? raw.sourceChannelId : "",
    channelId: String(raw.channelId),
    textChannelId: typeof raw.textChannelId === "string" ? raw.textChannelId : null,
    panelMessageId: typeof raw.panelMessageId === "string" ? raw.panelMessageId : null,
    ownerId: String(raw.ownerId),
    coOwnerIds: asStringArray(raw.coOwnerIds),
    allowedUserIds: asStringArray(raw.allowedUserIds),
    blacklistUserIds: asStringArray(raw.blacklistUserIds),
    allowedRoleIds: asStringArray(raw.allowedRoleIds),
    blacklistRoleIds: asStringArray(raw.blacklistRoleIds),
    number: Number(raw.number),
    createdAt: Number(raw.createdAt ?? Date.now()),
    deletedAt: typeof raw.deletedAt === "number" ? raw.deletedAt : null,
    locked: asBoolean(raw.locked, false),
    hidden: asBoolean(raw.hidden, false),
    serverMuteAll: asBoolean(raw.serverMuteAll, false),
    serverDeafenAll: asBoolean(raw.serverDeafenAll, false),
  }
}

const CONFIG_CACHE_TTL = 5_000
const configCache = new Map<string, { config: J2CConfig; ts: number }>()

export function invalidateConfig(guildId: string): void {
  configCache.delete(guildId)
}

export async function getConfig(guildId: string): Promise<J2CConfig> {
  const hit = configCache.get(guildId)
  if (hit && Date.now() - hit.ts < CONFIG_CACHE_TTL) return hit.config
  const raw = await J2CConfigs.findOne({ guildId }).lean()
  const config = normalizeConfig((raw as unknown as Record<string, unknown> | null) ?? { guildId })
  configCache.set(guildId, { config, ts: Date.now() })
  return config
}

export async function updateConfig(guildId: string, update: Record<string, unknown>): Promise<J2CConfig> {
  await J2CConfigs.findOneAndUpdate({ guildId }, update, { upsert: true })
  invalidateConfig(guildId)
  return getConfig(guildId)
}

export async function nextChannelNumber(guildId: string): Promise<number> {
  invalidateConfig(guildId)
  const doc = await J2CConfigs.findOneAndUpdate({ guildId }, { $inc: { counter: 1 } }, { upsert: true, new: true })
  return typeof doc?.counter === "number" && doc.counter > 0 ? Math.floor(doc.counter) : 1
}

export function padChannelNumber(value: number | string): string {
  const numeric = Math.max(0, Math.floor(typeof value === "number" ? value : Number(value) || 0))
  return String(numeric).padStart(4, "0")
}