import { randomInt } from "node:crypto"
import type { Client, GuildMember, GuildTextBasedChannel, Message } from "discord.js"
import config from "../../config.js"
import { Guild } from "../initData.js"
import {
  LevelUser,
  getConfig,
  levelFromXp,
  normalizeStats,
  type LevelsConfig,
  type MemberStats,
} from "./schema.js"

function formatNotify(template: string, userId: string, level: number, xp: number): string {
  return template
    .replaceAll("{user}", `<@${userId}>`)
    .replaceAll("{level}", String(level))
    .replaceAll("{xp}", String(xp))
}

export async function applyRewardRoles(member: GuildMember, config: LevelsConfig, level: number): Promise<void> {
  if (config.rewards.length === 0) return
  const earned = config.rewards.filter((item) => level >= item.level).sort((a, b) => a.level - b.level)
  const keep = new Set<string>()
  if (config.stackRoles) {
    for (const item of earned) keep.add(item.roleId)
  } else if (earned.length > 0) {
    const highest = earned[earned.length - 1]
    if (highest) keep.add(highest.roleId)
  }

  const rewardIds = [...new Set(config.rewards.map((item) => item.roleId))]
  const toAdd = [...keep].filter((id) => id !== member.guild.id && !member.roles.cache.has(id))
  const toRemove = rewardIds.filter((id) => id !== member.guild.id && !keep.has(id) && member.roles.cache.has(id))

  if (toAdd.length) {
    await member.roles.add(toAdd, "Niveaux — rôle de récompense").catch((error) => {
      console.error(`Failed to add level rewards in guild ${member.guild.id}:`, error)
    })
  }
  if (toRemove.length) {
    await member.roles.remove(toRemove, "Niveaux — rôle de récompense").catch((error) => {
      console.error(`Failed to remove level rewards in guild ${member.guild.id}:`, error)
    })
  }
}

async function sendLevelUp(message: Message, config: LevelsConfig, stats: MemberStats): Promise<void> {
  if (!config.notifyEnabled || !message.guild) return
  const content = formatNotify(config.notifyMessage, stats.userId, stats.level, stats.xp)
  const channelId = config.notifyChannelId ?? message.channelId
  let channel: GuildTextBasedChannel | null = null
  const cached = message.guild.channels.cache.get(channelId)
  if (cached && cached.isTextBased() && !cached.isDMBased()) {
    channel = cached
  } else {
    const fetched = await message.guild.channels.fetch(channelId).catch(() => null)
    if (fetched && fetched.isTextBased() && !fetched.isDMBased()) channel = fetched
  }
  if (!channel) return
  await channel
    .send({
      content,
      allowedMentions: { parse: [], users: [stats.userId] },
    })
    .catch((error) => {
      console.error(`Failed to send level-up in guild ${message.guild?.id}:`, error)
    })
}

async function resolvePrefix(guildId: string): Promise<string> {
  try {
    return (await Guild.findOne({ guildId }).select("prefix").lean())?.prefix ?? config.prefix
  } catch {
    return config.prefix
  }
}

export async function handleMessageXp(_client: Client, message: Message): Promise<void> {
  if (!message.guild || message.author.bot || message.system || message.webhookId) return

  const config = await getConfig(message.guild.id)
  if (!config.enabled) return
  if (config.ignoredChannels.includes(message.channelId)) return

  const prefix = await resolvePrefix(message.guild.id)
  if (prefix && message.content.startsWith(prefix)) return

  const member =
    message.member ??
    (await message.guild.members.fetch(message.author.id).catch(() => null))
  if (!member) return
  if (config.ignoredRoles.some((roleId) => member.roles.cache.has(roleId))) return

  const now = Date.now()
  const current = await LevelUser.findOne({ guildId: message.guild.id, userId: message.author.id }).lean()
  const previous = normalizeStats(current as Record<string, unknown> | null)
  if (previous && now - previous.lastXpAt < config.cooldown) return

  const gained = randomInt(config.xpMin, config.xpMax + 1)
  const oldXp = previous?.xp ?? 0
  const oldLevel = previous?.level ?? 0
  const xp = oldXp + gained
  const level = levelFromXp(xp)

  await LevelUser.findOneAndUpdate(
    { guildId: message.guild.id, userId: message.author.id },
    { $set: { xp, level, lastXpAt: now } },
    { upsert: true }
  )

  if (level <= oldLevel) return

  const stats: MemberStats = {
    guildId: message.guild.id,
    userId: message.author.id,
    xp,
    level,
    lastXpAt: now,
  }
  await applyRewardRoles(member, config, level)
  await sendLevelUp(message, config, stats)
}
