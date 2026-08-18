import type { Channel, Guild, GuildMember, Role } from "discord.js"
import { ModerationConfig, getModerationConfig } from "./schema.js"

const MUTE_ROLE_NAME = "Zenode Muted"

const TEXT_DENY = {
  SendMessages: false,
  SendMessagesInThreads: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  AddReactions: false,
}

const VOICE_DENY = {
  Speak: false,
  Stream: false,
}

export async function ensureMuteRole(guild: Guild): Promise<Role | null> {
  const config = await getModerationConfig(guild.id)
  if (config.muteRoleId) {
    const existing =
      guild.roles.cache.get(config.muteRoleId) ??
      (await guild.roles.fetch(config.muteRoleId).catch(() => null))
    if (existing) return existing
  }
  const byName = guild.roles.cache.find((role) => role.name === MUTE_ROLE_NAME)
  if (byName) {
    await ModerationConfig.updateOne({ guildId: guild.id }, { $set: { muteRoleId: byName.id } }, { upsert: true })
    return byName
  }
  const role = await guild.roles.create({
    name: MUTE_ROLE_NAME,
    reason: "Création automatique du rôle de mute (modération manuelle)",
  })
  await ModerationConfig.updateOne({ guildId: guild.id }, { $set: { muteRoleId: role.id } }, { upsert: true })
  return role
}

export async function applyMuteOverwritesToChannel(channel: Channel, role: Role): Promise<void> {
  try {
    if (channel.isDMBased()) return
    if (!channel.isTextBased() && !channel.isVoiceBased()) return
    if ("permissionOverwrites" in channel) {
      await channel.permissionOverwrites.edit(role.id, channel.isVoiceBased() ? VOICE_DENY : TEXT_DENY)
    }
  } catch {
    // Salon supprimé ou non modifiable — on ignore.
  }
}

export async function applyMuteOverwrites(guild: Guild, role: Role): Promise<void> {
  for (const channel of guild.channels.cache.values()) {
    await applyMuteOverwritesToChannel(channel, role)
  }
}

export async function addMuteRole(guild: Guild, member: GuildMember, reason: string): Promise<Role | null> {
  const role = await ensureMuteRole(guild)
  if (!role) return null
  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role, reason)
  }
  await applyMuteOverwrites(guild, role)
  return role
}

export async function getMuteRole(guild: Guild): Promise<Role | null> {
  const config = await getModerationConfig(guild.id)
  if (!config.muteRoleId) return null
  return guild.roles.cache.get(config.muteRoleId) ?? (await guild.roles.fetch(config.muteRoleId).catch(() => null))
}

export async function removeMuteRole(guild: Guild, member: GuildMember, reason?: string): Promise<void> {
  const role = await getMuteRole(guild)
  if (!role) return
  if (member.roles.cache.has(role.id)) {
    await member.roles.remove(role, reason ?? "Unmute manuel")
  }
}
