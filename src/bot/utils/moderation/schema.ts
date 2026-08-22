import { Schema, model } from "mongoose"
import type { AppEmojiName } from "../../../shared/botConfig.js"
import { applyBotScope, uniqueBotGuildIndex } from "../mongoScope.js"

export const MOD_ACTIONS = [
  "WARN",
  "UNWARN",
  "WARNINGS_CLEARED",
  "KICK",
  "BAN",
  "UNBAN",
  "SOFTBAN",
  "TIMEOUT",
  "UNTIMEOUT",
  "MUTE",
  "UNMUTE",
  "TEMPBAN",
  "TEMPMUTE",
  "TEMP_BAN_EXPIRED",
  "TEMP_MUTE_EXPIRED",
  "CLEAR",
  "PURGE",
  "SLOWMODE",
  "LOCK",
  "UNLOCK",
] as const
export type ModAction = (typeof MOD_ACTIONS)[number]

export const CASE_STATUSES = ["SUCCESS", "FAILED", "REVOKED", "EXPIRED", "CANCELLED", "DENIED"] as const
export type CaseStatus = (typeof CASE_STATUSES)[number]

export const ACTION_LABELS: Record<ModAction, string> = {
  WARN: "Avertissement",
  UNWARN: "Révocation d'avertissement",
  WARNINGS_CLEARED: "Suppression des avertissements",
  KICK: "Expulsion",
  BAN: "Bannissement",
  UNBAN: "Débannissement",
  SOFTBAN: "Softban",
  TIMEOUT: "Exclusion temporaire",
  UNTIMEOUT: "Fin de l'exclusion",
  MUTE: "Mute",
  UNMUTE: "Fin du mute",
  TEMPBAN: "Bannissement temporaire",
  TEMPMUTE: "Mute temporaire",
  TEMP_BAN_EXPIRED: "Expiration du bannissement temporaire",
  TEMP_MUTE_EXPIRED: "Expiration du mute temporaire",
  CLEAR: "Suppression de messages",
  PURGE: "Purge de messages",
  SLOWMODE: "Slowmode",
  LOCK: "Verrouillage",
  UNLOCK: "Déverrouillage",
}

export const ACTION_EMOJIS: Record<ModAction, AppEmojiName> = {
  WARN: "cancel",
  UNWARN: "check",
  WARNINGS_CLEARED: "cancel",
  KICK: "cancel",
  BAN: "cancel",
  UNBAN: "check",
  SOFTBAN: "cancel",
  TIMEOUT: "loop",
  UNTIMEOUT: "check",
  MUTE: "cancel",
  UNMUTE: "check",
  TEMPBAN: "loop",
  TEMPMUTE: "loop",
  TEMP_BAN_EXPIRED: "loop",
  TEMP_MUTE_EXPIRED: "loop",
  CLEAR: "cancel",
  PURGE: "cancel",
  SLOWMODE: "cog",
  LOCK: "power",
  UNLOCK: "check",
}

export const STATUS_LABELS: Record<CaseStatus, string> = {
  SUCCESS: "Effectué",
  FAILED: "Échec",
  REVOKED: "Révoqué",
  EXPIRED: "Expiré",
  CANCELLED: "Annulé",
  DENIED: "Refusé",
}

export function formatCaseId(n: number): string {
  return `CASE-${String(n).padStart(6, "0")}`
}

export function formatWarningId(n: number): string {
  return `WARN-${String(n).padStart(4, "0")}`
}

// ---------------------------------------------------------------------------
// ModerationConfig
// ---------------------------------------------------------------------------

export interface ModerationConfigDoc {
  guildId: string
  logChannelId: string | null
  caseCounter: number
  warningCounter: number
  muteRoleId: string | null
}

const moderationConfigSchema = new Schema<ModerationConfigDoc>(
  {
    guildId: { type: String, required: true, index: true },
    logChannelId: { type: String, default: null },
    caseCounter: { type: Number, default: 0 },
    warningCounter: { type: Number, default: 0 },
    muteRoleId: { type: String, default: null },
  },
  { timestamps: true }
)

applyBotScope(moderationConfigSchema)
uniqueBotGuildIndex(moderationConfigSchema)

export const ModerationConfig = model<ModerationConfigDoc>(
  "ModerationConfig",
  moderationConfigSchema,
  "moderation_configs"
)

// ---------------------------------------------------------------------------
// ModCase
// ---------------------------------------------------------------------------

export interface ModCaseDoc {
  caseId: number
  caseIdFormatted: string
  guildId: string
  guildName: string
  userId: string | null
  username: string
  globalName: string | null
  moderatorId: string | null
  moderatorUsername: string
  channelId: string | null
  channelName: string | null
  action: ModAction
  reason: string
  duration: number | null
  startedAt: number
  endAt: number | null
  status: CaseStatus
  error: string | null
  linkedCaseId: number | null
  linkedCaseIdFormatted: string | null
  dmStatus: "none" | "sent" | "failed"
  dmError: string | null
  metadata: Record<string, unknown>
}

const modCaseSchema = new Schema<ModCaseDoc>(
  {
    caseId: { type: Number, required: true },
    caseIdFormatted: { type: String, required: true },
    guildId: { type: String, required: true, index: true },
    guildName: { type: String, required: true },
    userId: { type: String, default: null, index: true },
    username: { type: String, default: "Inconnu" },
    globalName: { type: String, default: null },
    moderatorId: { type: String, default: null },
    moderatorUsername: { type: String, default: "Automatique" },
    channelId: { type: String, default: null },
    channelName: { type: String, default: null },
    action: { type: String, enum: MOD_ACTIONS, required: true },
    reason: { type: String, required: true },
    duration: { type: Number, default: null },
    startedAt: { type: Number, required: true },
    endAt: { type: Number, default: null },
    status: { type: String, enum: CASE_STATUSES, default: "SUCCESS" },
    error: { type: String, default: null },
    linkedCaseId: { type: Number, default: null },
    linkedCaseIdFormatted: { type: String, default: null },
    dmStatus: { type: String, enum: ["none", "sent", "failed"], default: "none" },
    dmError: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
)

applyBotScope(modCaseSchema)
modCaseSchema.index({ botId: 1, guildId: 1, caseId: 1 }, { unique: true })
modCaseSchema.index({ botId: 1, guildId: 1, userId: 1, caseId: -1 })

export const ModCase = model<ModCaseDoc>("ModCase", modCaseSchema, "mod_cases")

// ---------------------------------------------------------------------------
// Warning
// ---------------------------------------------------------------------------

export interface WarningDoc {
  warningId: number
  warningIdFormatted: string
  guildId: string
  userId: string
  username: string
  globalName: string | null
  moderatorId: string
  moderatorUsername: string
  reason: string
  timestamp: number
  caseId: number
  caseIdFormatted: string
  revoked: boolean
  revokedBy: string | null
  revokedAt: number | null
  revokeReason: string | null
  revokedCaseId: number | null
}

const warningSchema = new Schema<WarningDoc>(
  {
    warningId: { type: Number, required: true },
    warningIdFormatted: { type: String, required: true },
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    globalName: { type: String, default: null },
    moderatorId: { type: String, required: true },
    moderatorUsername: { type: String, required: true },
    reason: { type: String, required: true },
    timestamp: { type: Number, required: true },
    caseId: { type: Number, required: true },
    caseIdFormatted: { type: String, required: true },
    revoked: { type: Boolean, default: false },
    revokedBy: { type: String, default: null },
    revokedAt: { type: Number, default: null },
    revokeReason: { type: String, default: null },
    revokedCaseId: { type: Number, default: null },
  },
  { timestamps: true }
)

applyBotScope(warningSchema)
warningSchema.index({ botId: 1, guildId: 1, warningId: 1 }, { unique: true })

export const Warning = model<WarningDoc>("Warning", warningSchema, "mod_warnings")

// ---------------------------------------------------------------------------
// TemporarySanction
// ---------------------------------------------------------------------------

export interface TemporarySanctionDoc {
  guildId: string
  userId: string
  type: "TEMPBAN" | "TEMPMUTE"
  caseId: number
  expiresAt: number
  executed: boolean
}

const tempSanctionSchema = new Schema<TemporarySanctionDoc>(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    type: { type: String, enum: ["TEMPBAN", "TEMPMUTE"], required: true },
    caseId: { type: Number, required: true },
    expiresAt: { type: Number, required: true, index: true },
    executed: { type: Boolean, default: false },
  },
  { timestamps: true }
)

applyBotScope(tempSanctionSchema)

export const TemporarySanction = model<TemporarySanctionDoc>(
  "TemporarySanction",
  tempSanctionSchema,
  "mod_temp_sanctions"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function getModerationConfig(guildId: string): Promise<ModerationConfigDoc> {
  const doc = await ModerationConfig.findOne({ guildId }).lean()
  return doc ?? { guildId, logChannelId: null, caseCounter: 0, warningCounter: 0, muteRoleId: null }
}

export async function nextCaseId(guildId: string): Promise<number> {
  const doc = await ModerationConfig.findOneAndUpdate(
    { guildId },
    { $inc: { caseCounter: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean()
  return doc?.caseCounter ?? 1
}

export async function nextWarningId(guildId: string): Promise<number> {
  const doc = await ModerationConfig.findOneAndUpdate(
    { guildId },
    { $inc: { warningCounter: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean()
  return doc?.warningCounter ?? 1
}

export function metaString(c: { metadata: Record<string, unknown> }, key: string, fallback = "—"): string {
  const value = c.metadata[key]
  return typeof value === "string" && value ? value : fallback
}

export function metaNumber(c: { metadata: Record<string, unknown> }, key: string, fallback = 0): number {
  const value = c.metadata[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}
