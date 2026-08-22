import { Schema, model } from "mongoose"
import { applyBotScope, uniqueBotGuildIndex } from "../mongoScope.js"

export const MIN_DURATION = 10 * 1000
export const MAX_DURATION = 30 * 24 * 60 * 60 * 1000
export const MIN_WINNERS = 1
export const MAX_WINNERS = 20
export const MAX_PRIZE_LENGTH = 256

export interface GiveawayConfig {
  guildId: string
  defaultChannelId: string | null
  defaultWinnerCount: number
  requiredRoleId: string | null
}

export interface GiveawayRecord {
  id: string
  guildId: string
  channelId: string
  messageId: string
  prize: string
  winnerCount: number
  hostId: string
  requiredRoleId: string | null
  participants: string[]
  winners: string[]
  startsAt: number
  endsAt: number
  ended: boolean
  cancelled: boolean
  endedAt: number | null
}

export function defaultConfig(guildId: string): GiveawayConfig {
  return {
    guildId,
    defaultChannelId: null,
    defaultWinnerCount: 1,
    requiredRoleId: null,
  }
}

const configSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    defaultChannelId: { type: String, default: null },
    defaultWinnerCount: { type: Number, default: 1 },
    requiredRoleId: { type: String, default: null },
  },
  { timestamps: true }
)

applyBotScope(configSchema)
uniqueBotGuildIndex(configSchema)

export const GiveawayConfigModel = model("GiveawayConfig", configSchema, "giveaway")

const giveawaySchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: "" },
    prize: { type: String, required: true },
    winnerCount: { type: Number, required: true, default: 1 },
    hostId: { type: String, required: true },
    requiredRoleId: { type: String, default: null },
    participants: { type: [String], default: [] },
    winners: { type: [String], default: [] },
    startsAt: { type: Number, required: true },
    endsAt: { type: Number, required: true, index: true },
    ended: { type: Boolean, default: false, index: true },
    cancelled: { type: Boolean, default: false },
    endedAt: { type: Number, default: null },
  },
  { timestamps: true }
)

applyBotScope(giveawaySchema)
giveawaySchema.index({ botId: 1, guildId: 1, ended: 1, cancelled: 1 })
giveawaySchema.index({ botId: 1, guildId: 1, messageId: 1 })
giveawaySchema.index({ botId: 1, ended: 1, endsAt: 1 })

export const Giveaway = model("Giveaway", giveawaySchema, "giveaways")

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asStringOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null) return null
  return typeof value === "string" ? value : fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

export function clampDuration(ms: number): number {
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.floor(ms)))
}

export function clampWinners(n: number): number {
  return Math.min(MAX_WINNERS, Math.max(MIN_WINNERS, Math.floor(n)))
}

export function clampPrize(prize: string): string {
  return prize.trim().slice(0, MAX_PRIZE_LENGTH)
}

export function isGiveawayId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value)
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): GiveawayConfig {
  const guildId = typeof raw?.guildId === "string" ? raw.guildId : ""
  const defaults = defaultConfig(guildId)
  return {
    guildId,
    defaultChannelId: asStringOrNull(raw?.defaultChannelId, defaults.defaultChannelId),
    defaultWinnerCount: clampWinners(asNumber(raw?.defaultWinnerCount, defaults.defaultWinnerCount)),
    requiredRoleId: asStringOrNull(raw?.requiredRoleId, defaults.requiredRoleId),
  }
}

export function normalizeGiveaway(raw: Record<string, unknown> | null | undefined): GiveawayRecord | null {
  if (!raw) return null
  const id = raw.id ?? raw._id
  const idStr = typeof id === "string" ? id : id != null ? String(id) : ""
  if (!idStr) return null
  const winnerCount = Math.floor(asNumber(raw.winnerCount, 1))
  return {
    id: idStr,
    guildId: asString(raw.guildId, ""),
    channelId: asString(raw.channelId, ""),
    messageId: asString(raw.messageId, ""),
    prize: asString(raw.prize, ""),
    winnerCount: winnerCount >= 1 ? winnerCount : 1,
    hostId: asString(raw.hostId, ""),
    requiredRoleId: asStringOrNull(raw.requiredRoleId, null),
    participants: asStringArray(raw.participants),
    winners: asStringArray(raw.winners),
    startsAt: asNumber(raw.startsAt, 0),
    endsAt: asNumber(raw.endsAt, 0),
    ended: asBoolean(raw.ended, false),
    cancelled: asBoolean(raw.cancelled, false),
    endedAt: typeof raw.endedAt === "number" && Number.isFinite(raw.endedAt) ? raw.endedAt : null,
  }
}

const CONFIG_CACHE_TTL = 5_000
const cache = new Map<string, { config: GiveawayConfig; ts: number }>()

export function invalidateConfig(guildId: string): void {
  cache.delete(guildId)
}

export async function getConfig(guildId: string): Promise<GiveawayConfig> {
  const hit = cache.get(guildId)
  if (hit && Date.now() - hit.ts < CONFIG_CACHE_TTL) return hit.config
  const raw = await GiveawayConfigModel.findOne({ guildId }).lean()
  const config = normalizeConfig((raw as Record<string, unknown> | null) ?? { guildId })
  cache.set(guildId, { config, ts: Date.now() })
  return config
}

export async function updateConfig(guildId: string, update: Record<string, unknown>): Promise<GiveawayConfig> {
  await GiveawayConfigModel.findOneAndUpdate({ guildId }, update, { upsert: true })
  invalidateConfig(guildId)
  return getConfig(guildId)
}

export async function getGiveaway(id: string): Promise<GiveawayRecord | null> {
  if (!isGiveawayId(id)) return null
  const raw = await Giveaway.findById(id).lean()
  return normalizeGiveaway(raw as Record<string, unknown> | null)
}

export async function findGiveawayByMessage(guildId: string, messageId: string): Promise<GiveawayRecord | null> {
  const raw = await Giveaway.findOne({ guildId, messageId }).lean()
  return normalizeGiveaway(raw as Record<string, unknown> | null)
}

export async function listActiveGiveaways(guildId: string, limit = 25): Promise<GiveawayRecord[]> {
  const docs = await Giveaway.find({ guildId, ended: false, cancelled: false }).sort({ endsAt: 1 }).limit(limit).lean()
  return docs
    .map((doc) => normalizeGiveaway(doc as Record<string, unknown>))
    .filter((doc): doc is GiveawayRecord => doc !== null)
}

export async function listActiveGiveawaysAll(): Promise<GiveawayRecord[]> {
  const docs = await Giveaway.find({ ended: false, cancelled: false }).lean()
  return docs
    .map((doc) => normalizeGiveaway(doc as Record<string, unknown>))
    .filter((doc): doc is GiveawayRecord => doc !== null)
}

export async function listDueGiveaways(): Promise<GiveawayRecord[]> {
  const docs = await Giveaway.find({ ended: false, cancelled: false, endsAt: { $lte: Date.now() } }).lean()
  return docs
    .map((doc) => normalizeGiveaway(doc as Record<string, unknown>))
    .filter((doc): doc is GiveawayRecord => doc !== null)
}

export function extractMessageId(raw: string): string | null {
  const trimmed = raw.trim()
  const url = /channels\/\d+\/\d+\/(\d{17,20})/.exec(trimmed)
  if (url) return url[1]
  if (/^\d{17,20}$/.test(trimmed)) return trimmed
  return null
}

export async function resolveGiveaway(
  guildId: string,
  channelId: string | null,
  ref: string | undefined,
  mode: "active" | "ended" | "any"
): Promise<GiveawayRecord | null> {
  if (ref) {
    const messageId = extractMessageId(ref)
    if (messageId) {
      const byMessage = await findGiveawayByMessage(guildId, messageId)
      if (byMessage) return byMessage
    }
    if (isGiveawayId(ref.trim())) {
      const byId = await getGiveaway(ref.trim())
      if (byId && byId.guildId === guildId) return byId
    }
    return null
  }

  const statusFilter =
    mode === "active"
      ? { ended: false, cancelled: false }
      : mode === "ended"
        ? { ended: true, cancelled: false }
        : {}

  if (channelId) {
    const inChannel = await Giveaway.findOne({ guildId, channelId, ...statusFilter })
      .sort({ startsAt: -1 })
      .lean()
    const resolved = normalizeGiveaway(inChannel as Record<string, unknown> | null)
    if (resolved) return resolved
  }

  const inGuild = await Giveaway.findOne({ guildId, ...statusFilter }).sort({ startsAt: -1 }).lean()
  return normalizeGiveaway(inGuild as Record<string, unknown> | null)
}
