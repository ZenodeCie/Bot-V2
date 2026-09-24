import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type Client,
  type Collection,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type NonThreadGuildBasedChannel,
  type OverwriteData,
  type VoiceChannel,
  type VoiceState,
} from "discord.js"
import {
  EMPTY_GRACE_MS,
  J2CChannelRecords,
  MAX_CHANNEL_NAME_LENGTH,
  getConfig,
  mapRecord,
  nextChannelNumber,
  type J2CChannelRecord,
} from "./schema.js"
import { buildChannelName, contextFromMember } from "./variables.js"

const emptyTimers = new Map<string, NodeJS.Timeout>()
const creatingUsers = new Set<string>()
const active = new Map<string, J2CChannelRecord>()

const VOICE_BOT_ALLOW = [
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.CreateInstantInvite,
]
const TEXT_BOT_ALLOW = [
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.CreateInstantInvite,
]
const MEMBER_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
]
const TEXT_MEMBER_ALLOW = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]

function allowedUserIds(record: J2CChannelRecord): string[] {
  return [...new Set([record.ownerId, ...record.coOwnerIds, ...record.allowedUserIds])]
}

export function voiceChannelMembers(
  channel: GuildBasedChannel | undefined
): Collection<string, GuildMember> | null {
  if (!channel || !channel.isVoiceBased()) return null
  return channel.members
}

export function rememberRecord(record: J2CChannelRecord): void {
  active.set(record.channelId, record)
}

export function dropRecord(channelId: string): void {
  active.delete(channelId)
}

export async function recordByChannelId(channelId: string): Promise<J2CChannelRecord | null> {
  const cached = active.get(channelId)
  if (cached) return cached
  const raw = await J2CChannelRecords.findOne({ channelId }).lean().catch(() => null)
  if (!raw) return null
  const record = mapRecord(raw as unknown as Record<string, unknown>)
  active.set(channelId, record)
  return record
}

export async function saveRecord(record: J2CChannelRecord): Promise<void> {
  active.set(record.channelId, record)
  await J2CChannelRecords.updateOne({ channelId: record.channelId }, { $set: { ...record } }).catch(() => undefined)
}

export function memberIsAllowed(record: J2CChannelRecord, member: GuildMember): boolean {
  if (allowedUserIds(record).includes(member.id)) return true
  return record.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId))
}

export function memberIsBlacklisted(record: J2CChannelRecord, member: GuildMember): boolean {
  if (record.blacklistUserIds.includes(member.id)) return true
  return record.blacklistRoleIds.some((roleId) => member.roles.cache.has(roleId))
}

export function userHasAccess(record: J2CChannelRecord, userId: string): boolean {
  return record.ownerId === userId || record.coOwnerIds.includes(userId) || record.allowedUserIds.includes(userId)
}

export function userCanManage(record: J2CChannelRecord, userId: string): boolean {
  return record.ownerId === userId || record.coOwnerIds.includes(userId)
}

function buildVoiceOverwrites(guild: Guild, record: J2CChannelRecord, botId: string): OverwriteData[] {
  const overwrites: OverwriteData[] = []
  if (botId) overwrites.push({ id: botId, allow: [...VOICE_BOT_ALLOW, ...TEXT_BOT_ALLOW], type: OverwriteType.Member })
  if (record.hidden) {
    overwrites.push({
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
      type: OverwriteType.Role,
    })
  } else if (record.locked) {
    overwrites.push({
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
      type: OverwriteType.Role,
    })
  }
  for (const roleId of record.allowedRoleIds) {
    overwrites.push({ id: roleId, allow: MEMBER_ALLOW, type: OverwriteType.Role })
  }
  for (const roleId of record.blacklistRoleIds) {
    overwrites.push({ id: roleId, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], type: OverwriteType.Role })
  }
  for (const userId of allowedUserIds(record)) {
    overwrites.push({ id: userId, allow: MEMBER_ALLOW, type: OverwriteType.Member })
  }
  for (const userId of record.blacklistUserIds) {
    overwrites.push({ id: userId, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], type: OverwriteType.Member })
  }
  return overwrites
}

function buildTextOverwrites(guild: Guild, record: J2CChannelRecord, botId: string): OverwriteData[] {
  const overwrites: OverwriteData[] = []
  if (botId) overwrites.push({ id: botId, allow: TEXT_BOT_ALLOW, type: OverwriteType.Member })
  if (record.hidden) {
    overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel], type: OverwriteType.Role })
  }
  for (const roleId of record.allowedRoleIds) {
    overwrites.push({ id: roleId, allow: TEXT_MEMBER_ALLOW, type: OverwriteType.Role })
  }
  for (const roleId of record.blacklistRoleIds) {
    overwrites.push({ id: roleId, deny: [PermissionFlagsBits.ViewChannel], type: OverwriteType.Role })
  }
  for (const userId of allowedUserIds(record)) {
    overwrites.push({ id: userId, allow: TEXT_MEMBER_ALLOW, type: OverwriteType.Member })
  }
  for (const userId of record.blacklistUserIds) {
    overwrites.push({ id: userId, deny: [PermissionFlagsBits.ViewChannel], type: OverwriteType.Member })
  }
  return overwrites
}

export async function applyChannelPermissions(guild: Guild, record: J2CChannelRecord, botId?: string): Promise<void> {
  const meId = botId ?? guild.members.me?.id ?? ""
  const voice = guild.channels.cache.get(record.channelId)
  if (voice && "permissionOverwrites" in voice) {
    await voice.permissionOverwrites
      .set(buildVoiceOverwrites(guild, record, meId), "JoinToCreate — synchronisation des permissions du salon")
      .catch(() => undefined)
  }
  if (record.textChannelId) {
    const text = guild.channels.cache.get(record.textChannelId)
    if (text && "permissionOverwrites" in text) {
      await text.permissionOverwrites
        .set(buildTextOverwrites(guild, record, meId), "JoinToCreate — synchronisation des permissions de la discussion")
        .catch(() => undefined)
    }
  }
}

async function cancelEmptyCleanup(channelId: string): Promise<void> {
  const timer = emptyTimers.get(channelId)
  if (timer) {
    clearTimeout(timer)
    emptyTimers.delete(channelId)
  }
}

function scheduleEmptyCleanup(guild: Guild, record: J2CChannelRecord): void {
  const existing = emptyTimers.get(record.channelId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    emptyTimers.delete(record.channelId)
    const members = voiceChannelMembers(guild.channels.cache.get(record.channelId))
    if (members && members.size > 0) return
    void deleteChannel(guild, record, "Salon vocal vide")
  }, EMPTY_GRACE_MS)
  emptyTimers.set(record.channelId, timer)
}

export async function deleteChannel(guild: Guild, record: J2CChannelRecord, reason: string): Promise<void> {
  await cancelEmptyCleanup(record.channelId)
  dropRecord(record.channelId)
  await J2CChannelRecords.deleteOne({ channelId: record.channelId }).catch(() => undefined)
  const voice = guild.channels.cache.get(record.channelId)
  if (voice) await voice.delete(reason).catch(() => undefined)
  if (record.textChannelId) {
    const text = guild.channels.cache.get(record.textChannelId)
    if (text) await text.delete(reason).catch(() => undefined)
  }
}

async function applyStoredStateOnJoin(record: J2CChannelRecord, member: GuildMember): Promise<void> {
  if (record.serverMuteAll && !member.voice.serverMute) {
    await member.voice.setMute(true, "JoinToCreate — mute général activé").catch(() => undefined)
  }
  if (record.serverDeafenAll && !member.voice.serverDeaf) {
    await member.voice.setDeaf(true, "JoinToCreate — sourdine générale activée").catch(() => undefined)
  }
}

export async function transferOwnership(client: Client, guild: Guild, record: J2CChannelRecord, newOwnerId: string): Promise<void> {
  record.ownerId = newOwnerId
  record.coOwnerIds = record.coOwnerIds.filter((id) => id !== newOwnerId)
  await saveRecord(record)
  await applyChannelPermissions(guild, record).catch(() => undefined)
  const { refreshOwnerPanel } = await import("./dashboard.js")
  await refreshOwnerPanel(client, guild, record)
  const meId = guild.members.me?.id ?? ""
  const voice = guild.channels.cache.get(record.channelId)
  if (voice && "send" in voice && meId) {
    const target = guild.members.cache.get(newOwnerId)
    await voice
      .send({
        content: `> 👑 *La propriété du salon a été transférée à <@${newOwnerId}>${target ? ` (\`${target.user.username}\`)` : ""}. Vous pouvez gérer le salon via ce panneau.*`,
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined)
  }
}

async function createChannelForMember(client: Client, member: GuildMember): Promise<void> {
  const guild = member.guild
  if (creatingUsers.has(member.id)) return
  creatingUsers.add(member.id)
  try {
    const config = await getConfig(guild.id)
    if (!config.enabled || !config.sourceChannelId) return
    if (member.voice.channelId !== config.sourceChannelId) return

    const meId = guild.members.me?.id ?? ""
    const me = await guild.members.fetchMe().catch(() => null)
    if (me && !me.permissions.has(PermissionFlagsBits.ManageChannels)) return
    if (!meId) return

    const number = await nextChannelNumber(guild.id)
    const ctx = contextFromMember(member, number)
    const name = buildChannelName(config.channelNamePattern, ctx, MAX_CHANNEL_NAME_LENGTH)
    const sourceChannel = guild.channels.cache.get(config.sourceChannelId)
    const parent = config.categoryId ?? (sourceChannel ? sourceChannel.parentId : undefined) ?? undefined

    const voice = (await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent,
      userLimit: config.userLimit > 0 ? config.userLimit : undefined,
      permissionOverwrites: [{ id: meId, allow: [...VOICE_BOT_ALLOW, ...TEXT_BOT_ALLOW], type: OverwriteType.Member }],
      reason: `JoinToCreate #${number} — ${member.user.tag}`,
    })) as VoiceChannel

    const record: J2CChannelRecord = {
      guildId: guild.id,
      sourceChannelId: config.sourceChannelId,
      channelId: voice.id,
      textChannelId: null,
      panelMessageId: null,
      ownerId: member.id,
      coOwnerIds: [],
      allowedUserIds: [],
      blacklistUserIds: [],
      allowedRoleIds: [],
      blacklistRoleIds: [],
      number,
      createdAt: Date.now(),
      deletedAt: null,
      locked: false,
      hidden: false,
      serverMuteAll: false,
      serverDeafenAll: false,
    }
    await J2CChannelRecords.create({ ...record })
    rememberRecord(record)

    await member.voice.setChannel(voice).catch((error) => {
      console.error(`Failed to move ${member.user.tag} into their J2C channel ${voice.id}:`, error)
    })

    const { sendOwnerPanel } = await import("./dashboard.js")
    await sendOwnerPanel(client, guild, record)
  } catch (error) {
    console.error(`Failed to create a JoinToCreate channel in guild ${guild.id}:`, error)
  } finally {
    creatingUsers.delete(member.id)
  }
}

export async function handleVoiceStateUpdate(_client: Client, oldState: VoiceState, newState: VoiceState): Promise<void> {
  try {
    const guild = newState.guild ?? oldState.guild
    if (!guild) return
    const config = await getConfig(guild.id).catch(() => null)
    if (!config || !config.enabled || !config.sourceChannelId) return

    const member = newState.member ?? oldState.member
    const oldChannelId = oldState.channelId
    const newChannelId = newState.channelId

    if (newChannelId && newChannelId === config.sourceChannelId && oldChannelId !== newChannelId) {
      if (member && !(config.ignoreBots && member.user.bot)) {
        await createChannelForMember(guild.client as Client, member)
      }
      return
    }

    if (newChannelId && newChannelId !== oldChannelId) {
      const record = await recordByChannelId(newChannelId)
      if (record && member) {
        await cancelEmptyCleanup(record.channelId)
        if (memberIsBlacklisted(record, member)) {
          await member.voice.disconnect("JoinToCreate — membre blacklisté").catch(() => undefined)
          return
        }
        if (!memberIsAllowed(record, member) && (record.hidden || record.locked)) {
          await member.voice.disconnect("JoinToCreate — salon verrouillé ou masqué").catch(() => undefined)
          return
        }
        await applyStoredStateOnJoin(record, member)
      }
    }

    if (oldChannelId && oldChannelId !== newChannelId) {
      const leftRecord = await recordByChannelId(oldChannelId)
      if (!leftRecord) return
      const members = voiceChannelMembers(guild.channels.cache.get(oldChannelId))
      const count = members ? members.size : 0
      if (count === 0) {
        scheduleEmptyCleanup(guild, leftRecord)
      } else if (member && members && member.id === leftRecord.ownerId) {
        const oldest = [...members.values()].sort(
          (a, b) => (a.joinedTimestamp ?? Number.MAX_SAFE_INTEGER) - (b.joinedTimestamp ?? Number.MAX_SAFE_INTEGER)
        )[0]
        if (oldest && oldest.id !== leftRecord.ownerId) {
          await transferOwnership(guild.client as Client, guild, leftRecord, oldest.id)
        }
      }
    }
  } catch (error) {
    console.error(`JoinToCreate voiceStateUpdate error in guild ${newState.guild?.id ?? oldState.guild?.id ?? "?"}:`, error)
  }
}

export async function initJoinToCreate(client: Client): Promise<void> {
  try {
    const raw = await J2CChannelRecords.find({ deletedAt: null }).lean()
    for (const entry of raw) {
      const record = mapRecord(entry as unknown as Record<string, unknown>)
      const guild = client.guilds.cache.get(record.guildId)
      if (!guild) continue
      const voice = guild.channels.cache.get(record.channelId) as NonThreadGuildBasedChannel | undefined
      if (!voice) {
        dropRecord(record.channelId)
        await J2CChannelRecords.deleteOne({ channelId: record.channelId }).catch(() => undefined)
        continue
      }
      rememberRecord(record)
      await applyChannelPermissions(guild, record)
      if ((voiceChannelMembers(guild.channels.cache.get(record.channelId))?.size ?? 0) === 0) {
        scheduleEmptyCleanup(guild, record)
      }
    }
  } catch (error) {
    console.error("JoinToCreate init sweep failed:", error)
  }
}