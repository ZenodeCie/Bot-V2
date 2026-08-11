import type { Client, GuildMember, User } from "discord.js"
import { Schema, model } from "mongoose"

export interface PremiumConfigDoc {
  _id: string
  premiumServerId: string | null
  boosterRoleId: string | null
}

const premiumConfigSchema = new Schema<PremiumConfigDoc>(
  {
    _id: { type: String, required: true },
    premiumServerId: { type: String, default: null },
    boosterRoleId: { type: String, default: null },
  },
  { timestamps: true }
)

export const PremiumConfig = model<PremiumConfigDoc>(
  "PremiumConfig",
  premiumConfigSchema,
  "premium_config"
)

const GLOBAL_ID = "global"

export async function getPremiumConfig(): Promise<PremiumConfigDoc> {
  const doc = await PremiumConfig.findById(GLOBAL_ID).lean()
  return doc ?? { _id: GLOBAL_ID, premiumServerId: null, boosterRoleId: null }
}

export async function setPremiumServer(guildId: string): Promise<PremiumConfigDoc> {
  const doc = await PremiumConfig.findByIdAndUpdate(
    GLOBAL_ID,
    { $set: { premiumServerId: guildId, boosterRoleId: null } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean()
  return doc as unknown as PremiumConfigDoc
}

export async function setBoosterRole(roleId: string): Promise<PremiumConfigDoc | null> {
  const current = await getPremiumConfig()
  if (!current.premiumServerId) return null
  const doc = await PremiumConfig.findByIdAndUpdate(
    GLOBAL_ID,
    { $set: { boosterRoleId: roleId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean()
  return doc as unknown as PremiumConfigDoc
}

export async function resetPremiumConfig(): Promise<PremiumConfigDoc> {
  const doc = await PremiumConfig.findByIdAndUpdate(
    GLOBAL_ID,
    { $set: { premiumServerId: null, boosterRoleId: null } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean()
  return doc as unknown as PremiumConfigDoc
}

export async function isPremiumMember(member: GuildMember): Promise<boolean> {
  const cfg = await getPremiumConfig()
  if (!cfg.premiumServerId || !cfg.boosterRoleId) return false
  if (member.guild.id !== cfg.premiumServerId) return false
  return member.roles.cache.has(cfg.boosterRoleId)
}

export async function isPremiumUser(client: Client, user: User | string): Promise<boolean> {
  const cfg = await getPremiumConfig()
  if (!cfg.premiumServerId || !cfg.boosterRoleId) return false
  const guild = client.guilds.cache.get(cfg.premiumServerId)
  if (!guild) return false
  const id = typeof user === "string" ? user : user.id
  const member = await guild.members.fetch(id).catch(() => null)
  if (!member) return false
  return member.roles.cache.has(cfg.boosterRoleId)
}
