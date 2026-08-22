import { Schema, model } from "mongoose"
import { applyBotScope, uniqueBotGuildIndex, uniqueBotGuildUserIndex } from "../mongoScope.js"

export const MIN_XP = 1
export const MAX_XP = 100
export const MIN_COOLDOWN = 5 * 1000
export const MAX_COOLDOWN = 24 * 60 * 60 * 1000
export const MIN_LEVEL = 0
export const MAX_LEVEL = 1000
export const MIN_REWARD_LEVEL = 1
export const MAX_REWARDS = 25
export const MAX_NOTIFY_LENGTH = 256
export const DEFAULT_NOTIFY = "{user} vient de passer niveau **{level}** !"

export interface LevelReward {
  level: number
  roleId: string
}

export interface LevelsConfig {
  guildId: string
  enabled: boolean
  xpMin: number
  xpMax: number
  cooldown: number
  notifyEnabled: boolean
  notifyChannelId: string | null
  notifyMessage: string
  stackRoles: boolean
  ignoredChannels: string[]
  ignoredRoles: string[]
  rewards: LevelReward[]
}

export interface MemberStats {
  guildId: string
  userId: string
  xp: number
  level: number
  lastXpAt: number
}

export function xpForLevel(level: number): number {
  const n = Math.max(0, Math.floor(level))
  return 5 * n * n + 50 * n + 100
}

export function totalXpForLevel(level: number): number {
  const n = Math.max(0, Math.floor(level))
  let total = 0
  for (let i = 0; i < n; i++) total += xpForLevel(i)
  return total
}

export function levelFromXp(xp: number): number {
  let remaining = Math.max(0, Math.floor(xp))
  let level = 0
  while (remaining >= xpForLevel(level) && level < MAX_LEVEL) {
    remaining -= xpForLevel(level)
    level++
  }
  return level
}

export function xpProgress(xp: number): { level: number; into: number; needed: number; total: number } {
  const total = Math.max(0, Math.floor(xp))
  const level = levelFromXp(total)
  const into = total - totalXpForLevel(level)
  return { level, into, needed: xpForLevel(level), total }
}

export function clampXp(n: number): number {
  return Math.min(MAX_XP, Math.max(MIN_XP, Math.floor(n)))
}

export function clampCooldown(ms: number): number {
  return Math.min(MAX_COOLDOWN, Math.max(MIN_COOLDOWN, Math.floor(ms)))
}

export function clampLevel(n: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.floor(n)))
}

export function clampRewardLevel(n: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_REWARD_LEVEL, Math.floor(n)))
}

export function clampNotifyMessage(value: string): string {
  const trimmed = value.trim().slice(0, MAX_NOTIFY_LENGTH)
  return trimmed.length > 0 ? trimmed : DEFAULT_NOTIFY
}

export function defaultConfig(guildId: string): LevelsConfig {
  return {
    guildId,
    enabled: false,
    xpMin: 15,
    xpMax: 25,
    cooldown: 60 * 1000,
    notifyEnabled: true,
    notifyChannelId: null,
    notifyMessage: DEFAULT_NOTIFY,
    stackRoles: true,
    ignoredChannels: [],
    ignoredRoles: [],
    rewards: [],
  }
}

export function defaultStats(guildId: string, userId: string): MemberStats {
  return { guildId, userId, xp: 0, level: 0, lastXpAt: 0 }
}

const rewardSchema = new Schema(
  {
    level: { type: Number, required: true },
    roleId: { type: String, required: true },
  },
  { _id: false }
)

const configSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: false },
    xpMin: { type: Number, default: 15 },
    xpMax: { type: Number, default: 25 },
    cooldown: { type: Number, default: 60 * 1000 },
    notifyEnabled: { type: Boolean, default: true },
    notifyChannelId: { type: String, default: null },
    notifyMessage: { type: String, default: DEFAULT_NOTIFY },
    stackRoles: { type: Boolean, default: true },
    ignoredChannels: { type: [String], default: [] },
    ignoredRoles: { type: [String], default: [] },
    rewards: { type: [rewardSchema], default: [] },
  },
  { timestamps: true }
)

applyBotScope(configSchema)
uniqueBotGuildIndex(configSchema)

export const Levels = model("Levels", configSchema, "levels")

const statsSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    xp: { type: Number, default: 0, index: true },
    level: { type: Number, default: 0 },
    lastXpAt: { type: Number, default: 0 },
  },
  { timestamps: true }
)

applyBotScope(statsSchema)
uniqueBotGuildUserIndex(statsSchema)
statsSchema.index({ botId: 1, guildId: 1, xp: -1 })

export const LevelUser = model("LevelUser", statsSchema, "levels_users")

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

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const ids = value.filter((item): item is string => typeof item === "string" && /^\d{17,20}$/.test(item))
  return [...new Set(ids)].slice(0, 25)
}

function normalizeRewards(value: unknown): LevelReward[] {
  if (!Array.isArray(value)) return []
  const byRole = new Map<string, LevelReward>()
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const raw = item as Record<string, unknown>
    const roleId = typeof raw.roleId === "string" ? raw.roleId : ""
    if (!/^\d{17,20}$/.test(roleId)) continue
    const level = clampRewardLevel(asNumber(raw.level, MIN_REWARD_LEVEL))
    byRole.set(roleId, { level, roleId })
  }
  return [...byRole.values()].sort((a, b) => a.level - b.level || a.roleId.localeCompare(b.roleId)).slice(0, MAX_REWARDS)
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): LevelsConfig {
  const guildId = typeof raw?.guildId === "string" ? raw.guildId : ""
  const defaults = defaultConfig(guildId)
  let xpMin = clampXp(asNumber(raw?.xpMin, defaults.xpMin))
  let xpMax = clampXp(asNumber(raw?.xpMax, defaults.xpMax))
  if (xpMin > xpMax) {
    const swap = xpMin
    xpMin = xpMax
    xpMax = swap
  }
  return {
    guildId,
    enabled: asBoolean(raw?.enabled, defaults.enabled),
    xpMin,
    xpMax,
    cooldown: clampCooldown(asNumber(raw?.cooldown, defaults.cooldown)),
    notifyEnabled: asBoolean(raw?.notifyEnabled, defaults.notifyEnabled),
    notifyChannelId: asStringOrNull(raw?.notifyChannelId, defaults.notifyChannelId),
    notifyMessage: clampNotifyMessage(asString(raw?.notifyMessage, defaults.notifyMessage)),
    stackRoles: asBoolean(raw?.stackRoles, defaults.stackRoles),
    ignoredChannels: asStringArray(raw?.ignoredChannels, defaults.ignoredChannels),
    ignoredRoles: asStringArray(raw?.ignoredRoles, defaults.ignoredRoles),
    rewards: normalizeRewards(raw?.rewards),
  }
}

export function normalizeStats(raw: Record<string, unknown> | null | undefined): MemberStats | null {
  if (!raw) return null
  const guildId = asString(raw.guildId, "")
  const userId = asString(raw.userId, "")
  if (!guildId || !userId) return null
  const xp = Math.max(0, Math.floor(asNumber(raw.xp, 0)))
  const storedLevel = Math.floor(asNumber(raw.level, 0))
  return {
    guildId,
    userId,
    xp,
    level: storedLevel >= 0 ? clampLevel(storedLevel) : levelFromXp(xp),
    lastXpAt: Math.max(0, Math.floor(asNumber(raw.lastXpAt, 0))),
  }
}

const CONFIG_CACHE_TTL = 5_000
const cache = new Map<string, { config: LevelsConfig; ts: number }>()

export function invalidateConfig(guildId: string): void {
  cache.delete(guildId)
}

export async function getConfig(guildId: string): Promise<LevelsConfig> {
  const hit = cache.get(guildId)
  if (hit && Date.now() - hit.ts < CONFIG_CACHE_TTL) return hit.config
  const raw = await Levels.findOne({ guildId }).lean()
  const config = normalizeConfig((raw as Record<string, unknown> | null) ?? { guildId })
  cache.set(guildId, { config, ts: Date.now() })
  return config
}

export async function updateConfig(guildId: string, update: Record<string, unknown>): Promise<LevelsConfig> {
  await Levels.findOneAndUpdate({ guildId }, update, { upsert: true })
  invalidateConfig(guildId)
  return getConfig(guildId)
}

export async function getMemberStats(guildId: string, userId: string): Promise<MemberStats> {
  const raw = await LevelUser.findOne({ guildId, userId }).lean()
  return normalizeStats(raw as Record<string, unknown> | null) ?? defaultStats(guildId, userId)
}

export async function getMemberRank(guildId: string, userId: string): Promise<number> {
  const stats = await getMemberStats(guildId, userId)
  const better = await LevelUser.countDocuments({ guildId, xp: { $gt: stats.xp } })
  return better + 1
}

export async function listLeaderboard(guildId: string, limit = 10): Promise<MemberStats[]> {
  const docs = await LevelUser.find({ guildId }).sort({ xp: -1 }).limit(limit).lean()
  return docs
    .map((doc) => normalizeStats(doc as Record<string, unknown>))
    .filter((doc): doc is MemberStats => doc !== null)
}

export async function setMemberLevel(guildId: string, userId: string, level: number): Promise<MemberStats> {
  const nextLevel = clampLevel(level)
  const xp = totalXpForLevel(nextLevel)
  await LevelUser.findOneAndUpdate(
    { guildId, userId },
    { $set: { xp, level: nextLevel, lastXpAt: 0 } },
    { upsert: true }
  )
  return getMemberStats(guildId, userId)
}

export async function resetMember(guildId: string, userId: string): Promise<void> {
  await LevelUser.deleteOne({ guildId, userId })
}

export function upsertReward(rewards: LevelReward[], roleId: string, level: number): LevelReward[] {
  const next = rewards.filter((item) => item.roleId !== roleId)
  next.push({ roleId, level: clampRewardLevel(level) })
  return next.sort((a, b) => a.level - b.level || a.roleId.localeCompare(b.roleId)).slice(0, MAX_REWARDS)
}

export function removeReward(rewards: LevelReward[], roleId: string): LevelReward[] {
  return rewards.filter((item) => item.roleId !== roleId)
}
