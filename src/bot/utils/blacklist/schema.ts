import { Schema, model } from "mongoose"
import { applyBotScope, uniqueBotGuildIndex, uniqueBotGuildUserIndex } from "../mongoScope.js"
import type { Punishment } from "../antiraid/schema.js"

export const BLACKLIST_PUNISHMENTS = ["kick", "ban", "timeout", "none"] as const satisfies readonly Punishment[]
export type BlacklistPunishment = (typeof BLACKLIST_PUNISHMENTS)[number]

export interface BlacklistConfigDoc {
  guildId: string
  enabled: boolean
  punishment: BlacklistPunishment
  duration: number
  logChannel: string | null
}

const blacklistConfigSchema = new Schema<BlacklistConfigDoc>(
  {
    guildId: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: true },
    punishment: { type: String, enum: BLACKLIST_PUNISHMENTS, default: "kick" },
    duration: { type: Number, default: 0 },
    logChannel: { type: String, default: null },
  },
  { timestamps: true }
)

applyBotScope(blacklistConfigSchema)
uniqueBotGuildIndex(blacklistConfigSchema)

export const BlacklistConfig = model<BlacklistConfigDoc>(
  "BlacklistConfig",
  blacklistConfigSchema,
  "blacklist_configs"
)

const DEFAULT_CONFIG: Omit<BlacklistConfigDoc, "guildId"> = {
  enabled: true,
  punishment: "kick",
  duration: 0,
  logChannel: null,
}

export async function getConfig(guildId: string): Promise<BlacklistConfigDoc> {
  const doc = await BlacklistConfig.findOne({ guildId }).lean()
  if (!doc) return { guildId, ...DEFAULT_CONFIG }
  return {
    guildId,
    enabled: doc.enabled,
    punishment: BLACKLIST_PUNISHMENTS.includes(doc.punishment) ? doc.punishment : DEFAULT_CONFIG.punishment,
    duration: typeof doc.duration === "number" ? doc.duration : DEFAULT_CONFIG.duration,
    logChannel: doc.logChannel ?? null,
  }
}

// ---------------------------------------------------------------------------
// BlacklistEntry — utilisateurs en blacklist
// ---------------------------------------------------------------------------

export interface BlacklistEntryDoc {
  guildId: string
  userId: string
  username: string
  globalName: string | null
  reason: string
  moderatorId: string
  moderatorUsername: string
  addedAt: number
}

const blacklistEntrySchema = new Schema<BlacklistEntryDoc>(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    globalName: { type: String, default: null },
    reason: { type: String, required: true },
    moderatorId: { type: String, required: true },
    moderatorUsername: { type: String, required: true },
    addedAt: { type: Number, required: true },
  },
  { timestamps: true }
)

applyBotScope(blacklistEntrySchema)
uniqueBotGuildUserIndex(blacklistEntrySchema)

export const BlacklistEntry = model<BlacklistEntryDoc>(
  "BlacklistEntry",
  blacklistEntrySchema,
  "blacklist_entries"
)

export interface AddEntryInput {
  guildId: string
  userId: string
  username: string
  globalName: string | null
  reason: string
  moderatorId: string
  moderatorUsername: string
}

export async function addEntry(input: AddEntryInput): Promise<BlacklistEntryDoc> {
  const doc = await BlacklistEntry.findOneAndUpdate(
    { guildId: input.guildId, userId: input.userId },
    { ...input, addedAt: Date.now() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean()
  return doc as BlacklistEntryDoc
}

export async function removeEntry(guildId: string, userId: string): Promise<boolean> {
  const res = await BlacklistEntry.deleteOne({ guildId, userId })
  return res.deletedCount > 0
}

export async function getEntry(guildId: string, userId: string): Promise<BlacklistEntryDoc | null> {
  return BlacklistEntry.findOne({ guildId, userId }).lean()
}

export async function listEntries(guildId: string, skip: number, limit: number): Promise<BlacklistEntryDoc[]> {
  return BlacklistEntry.find({ guildId }).sort({ addedAt: -1 }).skip(skip).limit(limit).lean()
}

export async function countEntries(guildId: string): Promise<number> {
  return BlacklistEntry.countDocuments({ guildId })
}
