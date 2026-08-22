import { Schema, model } from "mongoose"
import { applyBotScope, uniqueBotGuildIndex, uniqueBotGuildUserIndex } from "../mongoScope.js"

export const MIN_FAKE_AGE = 0
export const MAX_FAKE_AGE = 30 * 24 * 60 * 60 * 1000
export const DEFAULT_FAKE_AGE = 7 * 24 * 60 * 60 * 1000
export const MIN_REWARD_INVITES = 1
export const MAX_REWARD_INVITES = 10_000
export const MAX_REWARDS = 25
export const MAX_BONUS = 1_000_000
export const VANITY_CODE = "vanity"

export interface InviteReward {
  invites: number
  roleId: string
}

export interface InvitationsConfig {
  guildId: string
  enabled: boolean
  logChannelId: string | null
  fakeAge: number
  ignoreBots: boolean
  countRejoins: boolean
  stackRoles: boolean
  rewards: InviteReward[]
}

export interface InviteStats {
  guildId: string
  userId: string
  regular: number
  left: number
  fake: number
  bonus: number
}

export interface JoinRecord {
  guildId: string
  userId: string
  inviterId: string | null
  code: string | null
  fake: boolean
  joinedAt: number
  leftAt: number | null
}

export function inviteTotal(stats: InviteStats): number {
  return Math.max(0, stats.regular + stats.bonus - stats.left - stats.fake)
}

export function clampFakeAge(ms: number): number {
  return Math.min(MAX_FAKE_AGE, Math.max(MIN_FAKE_AGE, Math.floor(ms)))
}

export function clampRewardInvites(n: number): number {
  return Math.min(MAX_REWARD_INVITES, Math.max(MIN_REWARD_INVITES, Math.floor(n)))
}

export function clampBonus(n: number): number {
  return Math.min(MAX_BONUS, Math.max(0, Math.floor(n)))
}

export function defaultConfig(guildId: string): InvitationsConfig {
  return {
    guildId,
    enabled: false,
    logChannelId: null,
    fakeAge: DEFAULT_FAKE_AGE,
    ignoreBots: true,
    countRejoins: false,
    stackRoles: true,
    rewards: [],
  }
}

export function defaultStats(guildId: string, userId: string): InviteStats {
  return { guildId, userId, regular: 0, left: 0, fake: 0, bonus: 0 }
}

const rewardSchema = new Schema(
  {
    invites: { type: Number, required: true },
    roleId: { type: String, required: true },
  },
  { _id: false }
)

const configSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: false },
    logChannelId: { type: String, default: null },
    fakeAge: { type: Number, default: DEFAULT_FAKE_AGE },
    ignoreBots: { type: Boolean, default: true },
    countRejoins: { type: Boolean, default: false },
    stackRoles: { type: Boolean, default: true },
    rewards: { type: [rewardSchema], default: [] },
  },
  { timestamps: true }
)

applyBotScope(configSchema)
uniqueBotGuildIndex(configSchema)

export const Invitations = model("Invitations", configSchema, "invitations")

const statsSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    regular: { type: Number, default: 0 },
    left: { type: Number, default: 0 },
    fake: { type: Number, default: 0 },
    bonus: { type: Number, default: 0 },
  },
  { timestamps: true }
)

applyBotScope(statsSchema)
uniqueBotGuildUserIndex(statsSchema)

export const InviteUser = model("InviteUser", statsSchema, "invitations_users")

const joinSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    inviterId: { type: String, default: null },
    code: { type: String, default: null },
    fake: { type: Boolean, default: false },
    joinedAt: { type: Number, default: 0 },
    leftAt: { type: Number, default: null },
  },
  { timestamps: true }
)

applyBotScope(joinSchema)
uniqueBotGuildUserIndex(joinSchema)

export const InviteJoin = model("InviteJoin", joinSchema, "invitations_joins")

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

function asCount(value: unknown, fallback = 0): number {
  return Math.max(0, Math.floor(asNumber(value, fallback)))
}

function normalizeRewards(value: unknown): InviteReward[] {
  if (!Array.isArray(value)) return []
  const byRole = new Map<string, InviteReward>()
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const raw = item as Record<string, unknown>
    const roleId = typeof raw.roleId === "string" ? raw.roleId : ""
    if (!/^\d{17,20}$/.test(roleId)) continue
    const invites = clampRewardInvites(asNumber(raw.invites, MIN_REWARD_INVITES))
    byRole.set(roleId, { invites, roleId })
  }
  return [...byRole.values()].sort((a, b) => a.invites - b.invites || a.roleId.localeCompare(b.roleId)).slice(0, MAX_REWARDS)
}

export function normalizeConfig(raw: Record<string, unknown> | null | undefined): InvitationsConfig {
  const guildId = typeof raw?.guildId === "string" ? raw.guildId : ""
  const defaults = defaultConfig(guildId)
  return {
    guildId,
    enabled: asBoolean(raw?.enabled, defaults.enabled),
    logChannelId: asStringOrNull(raw?.logChannelId, defaults.logChannelId),
    fakeAge: clampFakeAge(asNumber(raw?.fakeAge, defaults.fakeAge)),
    ignoreBots: asBoolean(raw?.ignoreBots, defaults.ignoreBots),
    countRejoins: asBoolean(raw?.countRejoins, defaults.countRejoins),
    stackRoles: asBoolean(raw?.stackRoles, defaults.stackRoles),
    rewards: normalizeRewards(raw?.rewards),
  }
}

export function normalizeStats(raw: Record<string, unknown> | null | undefined): InviteStats | null {
  if (!raw) return null
  const guildId = asString(raw.guildId, "")
  const userId = asString(raw.userId, "")
  if (!guildId || !userId) return null
  return {
    guildId,
    userId,
    regular: asCount(raw.regular),
    left: asCount(raw.left),
    fake: asCount(raw.fake),
    bonus: clampBonus(asCount(raw.bonus)),
  }
}

export function normalizeJoin(raw: Record<string, unknown> | null | undefined): JoinRecord | null {
  if (!raw) return null
  const guildId = asString(raw.guildId, "")
  const userId = asString(raw.userId, "")
  if (!guildId || !userId) return null
  const leftRaw = raw.leftAt
  return {
    guildId,
    userId,
    inviterId: asStringOrNull(raw.inviterId, null),
    code: asStringOrNull(raw.code, null),
    fake: asBoolean(raw.fake, false),
    joinedAt: Math.max(0, Math.floor(asNumber(raw.joinedAt, 0))),
    leftAt: leftRaw === null ? null : Math.max(0, Math.floor(asNumber(leftRaw, 0))) || null,
  }
}

const CONFIG_CACHE_TTL = 5_000
const cache = new Map<string, { config: InvitationsConfig; ts: number }>()

export function invalidateConfig(guildId: string): void {
  cache.delete(guildId)
}

export async function getConfig(guildId: string): Promise<InvitationsConfig> {
  const hit = cache.get(guildId)
  if (hit && Date.now() - hit.ts < CONFIG_CACHE_TTL) return hit.config
  const raw = await Invitations.findOne({ guildId }).lean()
  const config = normalizeConfig((raw as Record<string, unknown> | null) ?? { guildId })
  cache.set(guildId, { config, ts: Date.now() })
  return config
}

export async function updateConfig(guildId: string, update: Record<string, unknown>): Promise<InvitationsConfig> {
  await Invitations.findOneAndUpdate({ guildId }, update, { upsert: true })
  invalidateConfig(guildId)
  return getConfig(guildId)
}

export async function getMemberInvites(guildId: string, userId: string): Promise<InviteStats> {
  const raw = await InviteUser.findOne({ guildId, userId }).lean()
  return normalizeStats(raw as Record<string, unknown> | null) ?? defaultStats(guildId, userId)
}

const TOTAL_EXPR = {
  $max: [0, { $subtract: [{ $add: ["$regular", "$bonus"] }, { $add: ["$left", "$fake"] }] }],
}

export async function getMemberRank(guildId: string, userId: string): Promise<number> {
  const stats = await getMemberInvites(guildId, userId)
  const total = inviteTotal(stats)
  const [row] = await InviteUser.aggregate<{ n: number }>([
    { $match: { guildId } },
    { $addFields: { total: TOTAL_EXPR } },
    { $match: { total: { $gt: total } } },
    { $count: "n" },
  ])
  return (row?.n ?? 0) + 1
}

export async function listLeaderboard(guildId: string, limit = 10): Promise<Array<InviteStats & { total: number }>> {
  const docs = await InviteUser.aggregate<Record<string, unknown>>([
    { $match: { guildId } },
    { $addFields: { total: TOTAL_EXPR } },
    { $match: { total: { $gt: 0 } } },
    { $sort: { total: -1, regular: -1 } },
    { $limit: limit },
  ])
  return docs
    .map((doc) => {
      const stats = normalizeStats(doc)
      if (!stats) return null
      return { ...stats, total: inviteTotal(stats) }
    })
    .filter((doc): doc is InviteStats & { total: number } => doc !== null)
}

export async function addBonus(guildId: string, userId: string, amount: number): Promise<InviteStats> {
  const delta = Math.trunc(amount)
  if (delta === 0) return getMemberInvites(guildId, userId)
  await InviteUser.findOneAndUpdate(
    { guildId, userId },
    { $inc: { bonus: delta }, $setOnInsert: { regular: 0, left: 0, fake: 0 } },
    { upsert: true }
  )
  const stats = await getMemberInvites(guildId, userId)
  const bonus = clampBonus(stats.bonus)
  if (bonus !== stats.bonus) {
    await InviteUser.updateOne({ guildId, userId }, { $set: { bonus } })
    return { ...stats, bonus }
  }
  return stats
}

export type InviteStatField = "regular" | "left" | "fake"

export async function incrementInviter(guildId: string, userId: string, field: InviteStatField, amount = 1): Promise<InviteStats> {
  const insert: Record<string, number> = { regular: 0, left: 0, fake: 0, bonus: 0 }
  delete insert[field]
  await InviteUser.findOneAndUpdate(
    { guildId, userId },
    { $inc: { [field]: amount }, $setOnInsert: insert },
    { upsert: true }
  )
  return getMemberInvites(guildId, userId)
}

export async function resetMember(guildId: string, userId: string): Promise<void> {
  await InviteUser.deleteOne({ guildId, userId })
}

export async function getJoinRecord(guildId: string, userId: string): Promise<JoinRecord | null> {
  const raw = await InviteJoin.findOne({ guildId, userId }).lean()
  return normalizeJoin(raw as Record<string, unknown> | null)
}

export async function upsertJoin(record: JoinRecord): Promise<JoinRecord> {
  await InviteJoin.findOneAndUpdate(
    { guildId: record.guildId, userId: record.userId },
    {
      $set: {
        inviterId: record.inviterId,
        code: record.code,
        fake: record.fake,
        joinedAt: record.joinedAt,
        leftAt: record.leftAt,
      },
    },
    { upsert: true }
  )
  return (await getJoinRecord(record.guildId, record.userId)) ?? record
}

export function upsertReward(rewards: InviteReward[], roleId: string, invites: number): InviteReward[] {
  const next = rewards.filter((item) => item.roleId !== roleId)
  next.push({ roleId, invites: clampRewardInvites(invites) })
  return next.sort((a, b) => a.invites - b.invites || a.roleId.localeCompare(b.roleId)).slice(0, MAX_REWARDS)
}

export function removeReward(rewards: InviteReward[], roleId: string): InviteReward[] {
  return rewards.filter((item) => item.roleId !== roleId)
}
