import { Schema, model } from "mongoose"
import { applyBotScope, uniqueBotGuildIndex } from "../mongoScope.js"


export interface PartnershipConfigDoc {
  guildId: string
  enabled: boolean
  reviewChannel: string | null
  announceChannel: string | null
  partnerRole: string | null
  cooldown: number
  minMembers: number
  requestCounter: number
}

const partnershipConfigSchema = new Schema<PartnershipConfigDoc>(
  {
    guildId: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: true },
    reviewChannel: { type: String, default: null },
    announceChannel: { type: String, default: null },
    partnerRole: { type: String, default: null },
    cooldown: { type: Number, default: 24 * 60 * 60 * 1000 },
    minMembers: { type: Number, default: 0 },
    requestCounter: { type: Number, default: 0 },
  },
  { timestamps: true }
)

applyBotScope(partnershipConfigSchema)
uniqueBotGuildIndex(partnershipConfigSchema)

export const PartnershipConfig = model<PartnershipConfigDoc>(
  "PartnershipConfig",
  partnershipConfigSchema,
  "partnership_configs"
)

const DEFAULT_CONFIG: Omit<PartnershipConfigDoc, "guildId" | "requestCounter"> = {
  enabled: true,
  reviewChannel: null,
  announceChannel: null,
  partnerRole: null,
  cooldown: 24 * 60 * 60 * 1000,
  minMembers: 0,
}

export async function getConfig(guildId: string): Promise<PartnershipConfigDoc> {
  const doc = await PartnershipConfig.findOne({ guildId }).lean()
  if (!doc) return { guildId, ...DEFAULT_CONFIG, requestCounter: 0 }
  return {
    guildId,
    enabled: doc.enabled,
    reviewChannel: doc.reviewChannel ?? null,
    announceChannel: doc.announceChannel ?? null,
    partnerRole: doc.partnerRole ?? null,
    cooldown: typeof doc.cooldown === "number" ? doc.cooldown : DEFAULT_CONFIG.cooldown,
    minMembers: typeof doc.minMembers === "number" ? doc.minMembers : DEFAULT_CONFIG.minMembers,
    requestCounter: doc.requestCounter ?? 0,
  }
}

export function formatRequestId(n: number): string {
  return `PART-${String(n).padStart(6, "0")}`
}

export async function nextRequestId(guildId: string): Promise<number> {
  const doc = await PartnershipConfig.findOneAndUpdate(
    { guildId },
    { $inc: { requestCounter: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean()
  return doc?.requestCounter ?? 1
}

// ---------------------------------------------------------------------------
// PartnershipRequest — demandes soumises par les membres
// ---------------------------------------------------------------------------

export const REQUEST_STATUSES = ["PENDING", "APPROVED", "DENIED"] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export interface PartnershipRequestDoc {
  requestId: number
  requestIdFormatted: string
  guildId: string
  requesterId: string
  requesterUsername: string
  inviteCode: string
  targetGuildId: string
  targetGuildName: string
  targetMemberCount: number
  description: string
  status: RequestStatus
  reviewerId: string | null
  reviewerUsername: string | null
  reviewedAt: number | null
  denyReason: string | null
  reviewChannelId: string | null
  reviewMessageId: string | null
  createdAt: number
}

const partnershipRequestSchema = new Schema<PartnershipRequestDoc>(
  {
    requestId: { type: Number, required: true },
    requestIdFormatted: { type: String, required: true },
    guildId: { type: String, required: true, index: true },
    requesterId: { type: String, required: true, index: true },
    requesterUsername: { type: String, required: true },
    inviteCode: { type: String, required: true },
    targetGuildId: { type: String, required: true, index: true },
    targetGuildName: { type: String, required: true },
    targetMemberCount: { type: Number, default: 0 },
    description: { type: String, required: true },
    status: { type: String, enum: REQUEST_STATUSES, default: "PENDING" },
    reviewerId: { type: String, default: null },
    reviewerUsername: { type: String, default: null },
    reviewedAt: { type: Number, default: null },
    denyReason: { type: String, default: null },
    reviewChannelId: { type: String, default: null },
    reviewMessageId: { type: String, default: null },
    createdAt: { type: Number, required: true },
  },
  { timestamps: true }
)

applyBotScope(partnershipRequestSchema)
partnershipRequestSchema.index({ botId: 1, guildId: 1, requestId: 1 }, { unique: true })

export const PartnershipRequest = model<PartnershipRequestDoc>(
  "PartnershipRequest",
  partnershipRequestSchema,
  "partnership_requests"
)

// ---------------------------------------------------------------------------
// Partner — partenariats actifs
// ---------------------------------------------------------------------------

export interface PartnerDoc {
  guildId: string
  targetGuildId: string
  targetGuildName: string
  inviteCode: string
  requesterId: string
  requesterUsername: string
  requestId: number
  addedAt: number
}

const partnerSchema = new Schema<PartnerDoc>(
  {
    guildId: { type: String, required: true, index: true },
    targetGuildId: { type: String, required: true, index: true },
    targetGuildName: { type: String, required: true },
    inviteCode: { type: String, required: true },
    requesterId: { type: String, required: true },
    requesterUsername: { type: String, required: true },
    requestId: { type: Number, required: true },
    addedAt: { type: Number, required: true },
  },
  { timestamps: true }
)

applyBotScope(partnerSchema)
partnerSchema.index({ botId: 1, guildId: 1, targetGuildId: 1 }, { unique: true })

export const Partner = model<PartnerDoc>("Partner", partnerSchema, "partnership_partners")

export async function isActivePartner(guildId: string, targetGuildId: string): Promise<boolean> {
  const doc = await Partner.findOne({ guildId, targetGuildId }).lean()
  return !!doc
}

export async function listPartners(guildId: string, skip: number, limit: number): Promise<PartnerDoc[]> {
  return Partner.find({ guildId }).sort({ addedAt: -1 }).skip(skip).limit(limit).lean()
}

export async function countPartners(guildId: string): Promise<number> {
  return Partner.countDocuments({ guildId })
}

export async function removePartner(guildId: string, targetGuildId: string): Promise<boolean> {
  const res = await Partner.deleteOne({ guildId, targetGuildId })
  return res.deletedCount > 0
}

export async function findLastRequest(guildId: string, requesterId: string): Promise<PartnershipRequestDoc | null> {
  return PartnershipRequest.findOne({ guildId, requesterId }).sort({ createdAt: -1 }).lean()
}

export async function findPendingRequest(
  guildId: string,
  targetGuildId: string
): Promise<PartnershipRequestDoc | null> {
  return PartnershipRequest.findOne({ guildId, targetGuildId, status: "PENDING" }).lean()
}

export async function getRequestById(guildId: string, requestId: number): Promise<PartnershipRequestDoc | null> {
  return PartnershipRequest.findOne({ guildId, requestId }).lean()
}
