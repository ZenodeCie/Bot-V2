import {
  AuditLogEvent,
  ChannelType,
  EmbedBuilder,
  type Client,
  type Collection,
  type ColorResolvable,
  type Emoji,
  type Guild,
  type GuildAuditLogsEntry,
  type GuildBan,
  type GuildChannel,
  type GuildEmoji,
  type GuildMember,
  type GuildPremiumTier,
  type Invite,
  type Message,
  type PartialGuildMember,
  type PartialMessage,
  type Role,
  type Snowflake,
  type TextBasedChannel,
  type ThreadChannel,
  type VoiceState,
} from "discord.js"
import { colors } from "../../config.js"
import formatTime from "../formatTime.js"
import { getConfig, type EventKey, type LogsConfig } from "./schema.js"

const AUDIT_WINDOW_MS = 5_000
const CONTENT_MAX = 900

interface LogContext {
  isBot?: boolean
  channelId?: string | null
  skipLogChannel?: boolean
}

async function loadConfig(guildId: string): Promise<LogsConfig | null> {
  try {
    return await getConfig(guildId)
  } catch {
    return null
  }
}

export function buildLogEmbed(
  emojiChar: string,
  title: string,
  desc: string,
  color: `#${string}` | null = colors.prime
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(" ").setDescription(`# \`${emojiChar}\` 〃 ${title}\n${desc}`)
  if (color) embed.setColor(color as ColorResolvable)
  return embed
}

export async function sendLog(client: Client, guildId: string, embed: EmbedBuilder): Promise<void> {
  try {
    const config = await loadConfig(guildId)
    if (!config?.enabled || !config.channelId) return
    const channel = client.channels.cache.get(config.channelId)
    if (!channel || !channel.isTextBased() || !channel.isSendable() || channel.isDMBased()) return
    await channel.send({ embeds: [embed] })
  } catch (error) {
    console.error(`Failed to send guild log in guild ${guildId}:`, error)
  }
}

async function shouldLog(guildId: string, category: EventKey, context: LogContext = {}): Promise<boolean> {
  const config = await loadConfig(guildId)
  if (!config?.enabled || !config.channelId) return false
  if (!config.events[category]) return false
  if (config.ignoreBots && context.isBot) return false
  if (context.channelId && config.ignoredChannels.includes(context.channelId)) return false
  if (context.skipLogChannel && context.channelId && context.channelId === config.channelId) return false
  return true
}

async function findAudit(
  guild: Guild,
  type: AuditLogEvent,
  targetId?: string | null
): Promise<GuildAuditLogsEntry | null> {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 })
    const now = Date.now()
    for (const entry of logs.entries.values()) {
      if (now - entry.createdTimestamp > AUDIT_WINDOW_MS) continue
      if (targetId && entry.targetId && entry.targetId !== targetId) continue
      return entry
    }
  } catch {
    /* missing permission or not cached */
  }
  return null
}

function clip(value: string, max = CONTENT_MAX): string {
  const cleaned = value.replace(/```/g, "'''")
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max - 1)}…`
}

function contentBlock(value: string | null | undefined): string {
  const text = value?.trim() ? clip(value) : ""
  if (!text) return "*Aucun*"
  return `\`\`\`\n${text}\n\`\`\``
}

function userLine(user: { id: string; tag?: string | null; username?: string | null } | null | undefined): string {
  if (!user) return "*Inconnu*"
  const tag = user.tag || user.username || user.id
  return `<@${user.id}> (\`${tag}\` \`${user.id}\`)`
}

function executorLine(entry: GuildAuditLogsEntry | null): string {
  if (!entry?.executor) return ""
  return `\n> ***Auteur :** ${userLine(entry.executor)}*`
}

function reasonLine(entry: GuildAuditLogsEntry | null): string {
  const reason = entry?.reason?.trim()
  if (!reason) return ""
  return `\n> ***Raison :** ${clip(reason, 200)}*`
}

function channelLine(channelId: string | null | undefined): string {
  return channelId ? `<#${channelId}> (\`${channelId}\`)` : "*Inconnu*"
}

function channelTypeLabel(type: ChannelType | number): string {
  const labels: Partial<Record<ChannelType, string>> = {
    [ChannelType.GuildText]: "Textuel",
    [ChannelType.GuildVoice]: "Vocal",
    [ChannelType.GuildCategory]: "Catégorie",
    [ChannelType.GuildAnnouncement]: "Annonce",
    [ChannelType.AnnouncementThread]: "Fil d'annonce",
    [ChannelType.PublicThread]: "Fil public",
    [ChannelType.PrivateThread]: "Fil privé",
    [ChannelType.GuildStageVoice]: "Conférence",
    [ChannelType.GuildForum]: "Forum",
    [ChannelType.GuildMedia]: "Média",
  }
  return labels[type as ChannelType] ?? `Type ${type}`
}

function premiumTierLabel(tier: GuildPremiumTier | number): string {
  if (tier === 1) return "Niveau 1"
  if (tier === 2) return "Niveau 2"
  if (tier === 3) return "Niveau 3"
  return "Aucun"
}

function diffLine(label: string, before: string, after: string): string | null {
  if (before === after) return null
  return `> ***${label} :** \`${before || "—"}\` → \`${after || "—"}\`*`
}

async function emit(
  client: Client,
  guildId: string,
  category: EventKey,
  embed: EmbedBuilder,
  context?: LogContext
): Promise<void> {
  if (!(await shouldLog(guildId, category, context))) return
  await sendLog(client, guildId, embed)
}

function messageAuthor(message: Message | PartialMessage): { id: string; tag?: string; username?: string } | null {
  const author = message.author
  if (!author) return null
  return { id: author.id, tag: author.tag, username: author.username }
}

export async function handleMessageDelete(client: Client, message: Message | PartialMessage): Promise<void> {
  if (!message.guild) return
  let resolved: Message | PartialMessage = message
  if (message.partial) {
    resolved = await message.fetch().catch(() => message)
  }
  const author = messageAuthor(resolved)
  const audit = await findAudit(resolved.guild ?? message.guild, AuditLogEvent.MessageDelete, author?.id)
  const embed = buildLogEmbed(
    "🗑️",
    "Message supprimé",
    `> ***Auteur :** ${userLine(author)}\n` +
      `> ***Salon :** ${channelLine(resolved.channelId)}\n` +
      `> ***Message :** \`${resolved.id}\`*` +
      executorLine(audit) +
      `\n${contentBlock(resolved.content)}`,
    colors.red
  )
  await emit(client, message.guild.id, "messages", embed, {
    isBot: resolved.author?.bot ?? false,
    channelId: resolved.channelId,
    skipLogChannel: true,
  })
}

export async function handleMessageUpdate(
  client: Client,
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage
): Promise<void> {
  if (!newMessage.guild) return
  let before = oldMessage
  let after = newMessage
  if (oldMessage.partial) before = await oldMessage.fetch().catch(() => oldMessage)
  if (newMessage.partial) after = await newMessage.fetch().catch(() => newMessage)
  if (before.content === after.content) return
  const embed = buildLogEmbed(
    "✏️",
    "Message modifié",
    `> ***Auteur :** ${userLine(messageAuthor(after))}\n` +
      `> ***Salon :** ${channelLine(after.channelId)}\n` +
      `> ***Message :** \`${after.id}\`*\n` +
      `> ***Avant :**\n${contentBlock(before.content)}\n` +
      `> ***Après :**\n${contentBlock(after.content)}`,
    colors.yel
  )
  await emit(client, newMessage.guild.id, "messages", embed, {
    isBot: after.author?.bot ?? false,
    channelId: after.channelId,
    skipLogChannel: true,
  })
}

export async function handleMessageDeleteBulk(
  client: Client,
  messages: Collection<Snowflake, Message | PartialMessage>,
  channel: TextBasedChannel
): Promise<void> {
  if (!("guild" in channel) || !channel.guild) return
  const sample = [...messages.values()].slice(0, 8)
  const lines = sample
    .map((item) => {
      const author = messageAuthor(item)
      const preview = item.content ? clip(item.content, 80).replace(/\n/g, " ") : "*inconnu*"
      return `> • ${author ? `<@${author.id}>` : "*Inconnu*"} — ${preview}`
    })
    .join("\n")
  const embed = buildLogEmbed(
    "🧹",
    "Messages supprimés en masse",
    `> ***Salon :** ${channelLine(channel.id)}\n` +
      `> ***Nombre :** \`${messages.size}\`*\n` +
      (lines ? `\n${lines}` : ""),
    colors.red
  )
  await emit(client, channel.guild.id, "messages", embed, {
    channelId: channel.id,
    skipLogChannel: true,
  })
}

export async function handleMemberJoin(client: Client, member: GuildMember): Promise<void> {
  const created = Math.floor(member.user.createdTimestamp / 1000)
  const embed = buildLogEmbed(
    "📥",
    "Membre arrivé",
    `> ***Membre :** ${userLine(member.user)}\n` +
      `> ***Compte créé :** <t:${created}:R>*\n` +
      `> ***Bot :** ${member.user.bot ? "Oui" : "Non"}*\n` +
      `> ***Membres :** \`${member.guild.memberCount}\`*`,
    colors.prime
  )
  await emit(client, member.guild.id, "members", embed, { isBot: member.user.bot })
}

export async function handleMemberRemove(client: Client, member: GuildMember | PartialGuildMember): Promise<void> {
  const user = member.user
  const ban = await findAudit(member.guild, AuditLogEvent.MemberBanAdd, member.id)
  if (ban) return
  const kick = await findAudit(member.guild, AuditLogEvent.MemberKick, member.id)
  if (kick) {
    const embed = buildLogEmbed(
      "👢",
      "Membre expulsé",
      `> ***Membre :** ${userLine(user)}*` + executorLine(kick) + reasonLine(kick),
      colors.red
    )
    await emit(client, member.guild.id, "moderation", embed, { isBot: user?.bot })
    return
  }
  const embed = buildLogEmbed(
    "📤",
    "Membre parti",
    `> ***Membre :** ${userLine(user)}\n` + `> ***Membres :** \`${member.guild.memberCount}\`*`,
    colors.orng
  )
  await emit(client, member.guild.id, "members", embed, { isBot: user?.bot })
}

export async function handleMemberUpdate(
  client: Client,
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
): Promise<void> {
  const timeoutBefore = oldMember.communicationDisabledUntilTimestamp ?? null
  const timeoutAfter = newMember.communicationDisabledUntilTimestamp ?? null
  if (timeoutBefore !== timeoutAfter) {
    const audit = await findAudit(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id)
    if (timeoutAfter && timeoutAfter > Date.now()) {
      const embed = buildLogEmbed(
        "⏳",
        "Timeout appliqué",
        `> ***Membre :** ${userLine(newMember.user)}\n` +
          `> ***Fin :** <t:${Math.floor(timeoutAfter / 1000)}:R>*` +
          executorLine(audit) +
          reasonLine(audit),
        colors.orng
      )
      await emit(client, newMember.guild.id, "moderation", embed, { isBot: newMember.user.bot })
    } else {
      const embed = buildLogEmbed(
        "✅",
        "Timeout retiré",
        `> ***Membre :** ${userLine(newMember.user)}*` + executorLine(audit),
        colors.prime
      )
      await emit(client, newMember.guild.id, "moderation", embed, { isBot: newMember.user.bot })
    }
  }

  const nickBefore = oldMember.nickname ?? oldMember.user?.username ?? ""
  const nickAfter = newMember.nickname ?? newMember.user.username
  const added = newMember.roles.cache.filter((role) => role.id !== newMember.guild.id && !oldMember.roles.cache.has(role.id))
  const removed = oldMember.roles.cache.filter((role) => role.id !== newMember.guild.id && !newMember.roles.cache.has(role.id))
  const nickChanged = nickBefore !== nickAfter
  const rolesChanged = added.size > 0 || removed.size > 0
  if (nickChanged || rolesChanged) {
    const parts = [`> ***Membre :** ${userLine(newMember.user)}*`]
    if (nickChanged) parts.push(`> ***Pseudo :** \`${nickBefore || "—"}\` → \`${nickAfter || "—"}\`*`)
    if (added.size) parts.push(`> ***Rôles ajoutés :** ${[...added.values()].map((role) => `${role}`).join(" ")}*`)
    if (removed.size) parts.push(`> ***Rôles retirés :** ${[...removed.values()].map((role) => `${role}`).join(" ")}*`)
    const audit = await findAudit(
      newMember.guild,
      rolesChanged ? AuditLogEvent.MemberRoleUpdate : AuditLogEvent.MemberUpdate,
      newMember.id
    )
    const embed = buildLogEmbed("👤", "Membre mis à jour", parts.join("\n") + executorLine(audit), colors.yel)
    await emit(client, newMember.guild.id, "members", embed, { isBot: newMember.user.bot })
  }

  const boostBefore = oldMember.premiumSinceTimestamp ?? null
  const boostAfter = newMember.premiumSinceTimestamp ?? null
  if (boostBefore !== boostAfter) {
    const embed = buildLogEmbed(
      "🚀",
      boostAfter ? "Boost ajouté" : "Boost retiré",
      `> ***Membre :** ${userLine(newMember.user)}*`,
      boostAfter ? colors.prime : colors.orng
    )
    await emit(client, newMember.guild.id, "server", embed, { isBot: newMember.user.bot })
  }
}

export async function handleBanAdd(client: Client, ban: GuildBan): Promise<void> {
  const audit = await findAudit(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id)
  const embed = buildLogEmbed(
    "🔨",
    "Membre banni",
    `> ***Membre :** ${userLine(ban.user)}*` + executorLine(audit) + reasonLine(audit) + (ban.reason ? `\n> ***Raison :** ${clip(ban.reason, 200)}*` : ""),
    colors.red
  )
  await emit(client, ban.guild.id, "moderation", embed, { isBot: ban.user.bot })
}

export async function handleBanRemove(client: Client, ban: GuildBan): Promise<void> {
  const audit = await findAudit(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id)
  const embed = buildLogEmbed(
    "🕊️",
    "Membre débanni",
    `> ***Membre :** ${userLine(ban.user)}*` + executorLine(audit) + reasonLine(audit),
    colors.prime
  )
  await emit(client, ban.guild.id, "moderation", embed, { isBot: ban.user.bot })
}

export async function handleVoiceStateUpdate(client: Client, oldState: VoiceState, newState: VoiceState): Promise<void> {
  const member = newState.member ?? oldState.member
  const guild = newState.guild
  const user = member?.user ?? newState.member?.user
  const isBot = user?.bot ?? false
  const who = userLine(user)

  if (oldState.channelId !== newState.channelId) {
    if (!oldState.channelId && newState.channelId) {
      const embed = buildLogEmbed("🔊", "Vocal — arrivée", `> ***Membre :** ${who}\n> ***Salon :** ${channelLine(newState.channelId)}*`, colors.prime)
      await emit(client, guild.id, "voice", embed, { isBot, channelId: newState.channelId })
    } else if (oldState.channelId && !newState.channelId) {
      const embed = buildLogEmbed("🔇", "Vocal — départ", `> ***Membre :** ${who}\n> ***Salon :** ${channelLine(oldState.channelId)}*`, colors.orng)
      await emit(client, guild.id, "voice", embed, { isBot, channelId: oldState.channelId })
    } else {
      const embed = buildLogEmbed(
        "🔀",
        "Vocal — déplacement",
        `> ***Membre :** ${who}\n> ***De :** ${channelLine(oldState.channelId)}\n> ***Vers :** ${channelLine(newState.channelId)}*`,
        colors.yel
      )
      await emit(client, guild.id, "voice", embed, { isBot, channelId: newState.channelId })
    }
  }

  const flags: string[] = []
  if (oldState.serverMute !== newState.serverMute) flags.push(`> ***Mute serveur :** ${newState.serverMute ? "Oui" : "Non"}*`)
  if (oldState.serverDeaf !== newState.serverDeaf) flags.push(`> ***Sourdine serveur :** ${newState.serverDeaf ? "Oui" : "Non"}*`)
  if (oldState.selfMute !== newState.selfMute) flags.push(`> ***Mute :** ${newState.selfMute ? "Oui" : "Non"}*`)
  if (oldState.selfDeaf !== newState.selfDeaf) flags.push(`> ***Casque :** ${newState.selfDeaf ? "Oui" : "Non"}*`)
  if (oldState.streaming !== newState.streaming) flags.push(`> ***Stream :** ${newState.streaming ? "Oui" : "Non"}*`)
  if (oldState.selfVideo !== newState.selfVideo) flags.push(`> ***Caméra :** ${newState.selfVideo ? "Oui" : "Non"}*`)
  if (flags.length) {
    const embed = buildLogEmbed(
      "🎙️",
      "Vocal — état",
      `> ***Membre :** ${who}\n> ***Salon :** ${channelLine(newState.channelId ?? oldState.channelId)}\n${flags.join("\n")}`,
      colors.yel
    )
    await emit(client, guild.id, "voice", embed, { isBot, channelId: newState.channelId ?? oldState.channelId })
  }
}

function isThreadLike(channel: { isThread?: () => boolean }): boolean {
  return typeof channel.isThread === "function" && channel.isThread()
}

export async function handleChannelCreate(client: Client, channel: GuildChannel): Promise<void> {
  if (isThreadLike(channel)) return
  const audit = await findAudit(channel.guild, AuditLogEvent.ChannelCreate, channel.id)
  const embed = buildLogEmbed(
    "📁",
    "Salon créé",
    `> ***Salon :** ${channelLine(channel.id)}\n` +
      `> ***Nom :** \`${channel.name}\`*\n` +
      `> ***Type :** ${channelTypeLabel(channel.type)}*` +
      executorLine(audit),
    colors.prime
  )
  await emit(client, channel.guild.id, "channels", embed, { channelId: channel.id })
}

export async function handleChannelDelete(client: Client, channel: GuildChannel | ThreadChannel): Promise<void> {
  if (isThreadLike(channel)) return
  if (!("guild" in channel) || !channel.guild) return
  const audit = await findAudit(channel.guild, AuditLogEvent.ChannelDelete, channel.id)
  const embed = buildLogEmbed(
    "📁",
    "Salon supprimé",
    `> ***Salon :** \`${channel.name}\` (\`${channel.id}\`)\n` +
      `> ***Type :** ${channelTypeLabel(channel.type)}*` +
      executorLine(audit),
    colors.red
  )
  await emit(client, channel.guild.id, "channels", embed, { channelId: channel.id })
}

function overwriteSignature(channel: GuildChannel): string {
  if (!channel.permissionOverwrites) return ""
  return [...channel.permissionOverwrites.cache.values()]
    .map((overwrite) => `${overwrite.id}:${overwrite.allow.bitfield}:${overwrite.deny.bitfield}`)
    .sort()
    .join("|")
}

export async function handleChannelUpdate(client: Client, oldChannel: GuildChannel, newChannel: GuildChannel): Promise<void> {
  if (isThreadLike(newChannel)) return
  const diffs = [
    diffLine("Nom", oldChannel.name, newChannel.name),
    "topic" in oldChannel || "topic" in newChannel
      ? diffLine(
          "Sujet",
          "topic" in oldChannel ? String(oldChannel.topic ?? "") : "",
          "topic" in newChannel ? String(newChannel.topic ?? "") : ""
        )
      : null,
    "nsfw" in oldChannel || "nsfw" in newChannel
      ? diffLine(
          "NSFW",
          "nsfw" in oldChannel && oldChannel.nsfw ? "Oui" : "Non",
          "nsfw" in newChannel && newChannel.nsfw ? "Oui" : "Non"
        )
      : null,
    "rateLimitPerUser" in oldChannel || "rateLimitPerUser" in newChannel
      ? diffLine(
          "Slowmode",
          "rateLimitPerUser" in oldChannel ? String(oldChannel.rateLimitPerUser ?? 0) : "0",
          "rateLimitPerUser" in newChannel ? String(newChannel.rateLimitPerUser ?? 0) : "0"
        )
      : null,
    diffLine("Catégorie", oldChannel.parentId ?? "", newChannel.parentId ?? ""),
  ].filter((line): line is string => Boolean(line))
  if (overwriteSignature(oldChannel) !== overwriteSignature(newChannel)) {
    diffs.push("> ***Permissions :** mises à jour*")
  }
  if (!diffs.length) return
  const audit = await findAudit(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id)
  const embed = buildLogEmbed(
    "📁",
    "Salon modifié",
    `> ***Salon :** ${channelLine(newChannel.id)}\n${diffs.join("\n")}` + executorLine(audit),
    colors.yel
  )
  await emit(client, newChannel.guild.id, "channels", embed, { channelId: newChannel.id })
}

export async function handleRoleCreate(client: Client, role: Role): Promise<void> {
  const audit = await findAudit(role.guild, AuditLogEvent.RoleCreate, role.id)
  const embed = buildLogEmbed(
    "🎭",
    "Rôle créé",
    `> ***Rôle :** ${role} (\`${role.name}\` \`${role.id}\`)*` + executorLine(audit),
    colors.prime
  )
  await emit(client, role.guild.id, "roles", embed)
}

export async function handleRoleDelete(client: Client, role: Role): Promise<void> {
  const audit = await findAudit(role.guild, AuditLogEvent.RoleDelete, role.id)
  const embed = buildLogEmbed(
    "🎭",
    "Rôle supprimé",
    `> ***Rôle :** \`${role.name}\` (\`${role.id}\`)*` + executorLine(audit),
    colors.red
  )
  await emit(client, role.guild.id, "roles", embed)
}

export async function handleRoleUpdate(client: Client, oldRole: Role, newRole: Role): Promise<void> {
  const diffs = [
    diffLine("Nom", oldRole.name, newRole.name),
    diffLine("Couleur", oldRole.hexColor, newRole.hexColor),
    diffLine("Affiché séparément", oldRole.hoist ? "Oui" : "Non", newRole.hoist ? "Oui" : "Non"),
    diffLine("Mentionnable", oldRole.mentionable ? "Oui" : "Non", newRole.mentionable ? "Oui" : "Non"),
    diffLine("Permissions", oldRole.permissions.bitfield.toString(), newRole.permissions.bitfield.toString()),
  ].filter((line): line is string => Boolean(line))
  if (!diffs.length) return
  const audit = await findAudit(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id)
  const embed = buildLogEmbed(
    "🎭",
    "Rôle modifié",
    `> ***Rôle :** ${newRole} (\`${newRole.id}\`)\n${diffs.join("\n")}` + executorLine(audit),
    colors.yel
  )
  await emit(client, newRole.guild.id, "roles", embed)
}

export async function handleGuildUpdate(client: Client, oldGuild: Guild, newGuild: Guild): Promise<void> {
  const diffs = [
    diffLine("Nom", oldGuild.name, newGuild.name),
    diffLine("Description", oldGuild.description ?? "", newGuild.description ?? ""),
    diffLine("Vanity", oldGuild.vanityURLCode ?? "", newGuild.vanityURLCode ?? ""),
    diffLine("Vérification", String(oldGuild.verificationLevel), String(newGuild.verificationLevel)),
    diffLine("Boosts", String(oldGuild.premiumSubscriptionCount ?? 0), String(newGuild.premiumSubscriptionCount ?? 0)),
    diffLine("Niveau de boost", premiumTierLabel(oldGuild.premiumTier), premiumTierLabel(newGuild.premiumTier)),
    diffLine("AFK", oldGuild.afkChannelId ?? "", newGuild.afkChannelId ?? ""),
    diffLine("Salon système", oldGuild.systemChannelId ?? "", newGuild.systemChannelId ?? ""),
    oldGuild.icon !== newGuild.icon ? "> ***Icône :** mise à jour*" : null,
    oldGuild.banner !== newGuild.banner ? "> ***Bannière :** mise à jour*" : null,
    oldGuild.ownerId !== newGuild.ownerId ? `> ***Propriétaire :** <@${oldGuild.ownerId}> → <@${newGuild.ownerId}>*` : null,
  ].filter((line): line is string => Boolean(line))
  if (!diffs.length) return
  const audit = await findAudit(newGuild, AuditLogEvent.GuildUpdate, newGuild.id)
  const embed = buildLogEmbed("🏠", "Serveur modifié", diffs.join("\n") + executorLine(audit), colors.yel)
  await emit(client, newGuild.id, "server", embed)
}

function emojiLabel(emoji: GuildEmoji | Emoji): string {
  const name = "name" in emoji && emoji.name ? emoji.name : "?"
  const id = "id" in emoji && emoji.id ? emoji.id : "?"
  const animated = "animated" in emoji && emoji.animated ? "a" : ""
  if (id !== "?") return `<${animated}:${name}:${id}> (\`${name}\`)`
  return `\`${name}\``
}

export async function handleEmojiCreate(client: Client, emoji: GuildEmoji): Promise<void> {
  const audit = await findAudit(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id)
  const embed = buildLogEmbed("😀", "Emoji créé", `> ***Emoji :** ${emojiLabel(emoji)}*` + executorLine(audit), colors.prime)
  await emit(client, emoji.guild.id, "server", embed)
}

export async function handleEmojiDelete(client: Client, emoji: GuildEmoji): Promise<void> {
  const audit = await findAudit(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id)
  const embed = buildLogEmbed("😀", "Emoji supprimé", `> ***Emoji :** ${emojiLabel(emoji)}*` + executorLine(audit), colors.red)
  await emit(client, emoji.guild.id, "server", embed)
}

export async function handleEmojiUpdate(client: Client, oldEmoji: GuildEmoji, newEmoji: GuildEmoji): Promise<void> {
  if (oldEmoji.name === newEmoji.name) return
  const audit = await findAudit(newEmoji.guild, AuditLogEvent.EmojiUpdate, newEmoji.id)
  const embed = buildLogEmbed(
    "😀",
    "Emoji modifié",
    `> ***Emoji :** ${emojiLabel(newEmoji)}\n> ***Nom :** \`${oldEmoji.name ?? "?"}\` → \`${newEmoji.name ?? "?"}\`*` +
      executorLine(audit),
    colors.yel
  )
  await emit(client, newEmoji.guild.id, "server", embed)
}

export async function handleInviteCreate(client: Client, invite: Invite): Promise<void> {
  const guild = invite.guild
  if (!guild) return
  const maxAge = invite.maxAge ? formatTime(invite.maxAge * 1000) : "Illimitée"
  const embed = buildLogEmbed(
    "🔗",
    "Invitation créée",
    `> ***Code :** \`${invite.code}\`*\n` +
      `> ***Salon :** ${channelLine(invite.channelId)}\n` +
      `> ***Auteur :** ${userLine(invite.inviter)}\n` +
      `> ***Utilisations max :** \`${invite.maxUses || "Illimitées"}\`*\n` +
      `> ***Expiration :** \`${maxAge}\`*`,
    colors.prime
  )
  await emit(client, guild.id, "invites", embed, { isBot: invite.inviter?.bot, channelId: invite.channelId })
}

export async function handleInviteDelete(client: Client, invite: Invite): Promise<void> {
  const guild = invite.guild
  if (!guild) return
  const embed = buildLogEmbed(
    "🔗",
    "Invitation supprimée",
    `> ***Code :** \`${invite.code}\`*\n> ***Salon :** ${channelLine(invite.channelId)}`,
    colors.orng
  )
  await emit(client, guild.id, "invites", embed, { channelId: invite.channelId })
}

export async function handleThreadCreate(client: Client, thread: ThreadChannel): Promise<void> {
  if (!thread.guild) return
  const embed = buildLogEmbed(
    "🧵",
    "Fil créé",
    `> ***Fil :** ${channelLine(thread.id)}\n` +
      `> ***Nom :** \`${thread.name}\`*\n` +
      `> ***Parent :** ${channelLine(thread.parentId)}\n` +
      `> ***Auteur :** ${thread.ownerId ? `<@${thread.ownerId}>` : "*Inconnu*"}*`,
    colors.prime
  )
  await emit(client, thread.guild.id, "threads", embed, { channelId: thread.id, skipLogChannel: true })
}

export async function handleThreadDelete(client: Client, thread: ThreadChannel): Promise<void> {
  if (!thread.guild) return
  const embed = buildLogEmbed(
    "🧵",
    "Fil supprimé",
    `> ***Fil :** \`${thread.name}\` (\`${thread.id}\`)\n> ***Parent :** ${channelLine(thread.parentId)}`,
    colors.red
  )
  await emit(client, thread.guild.id, "threads", embed, { channelId: thread.id, skipLogChannel: true })
}

export async function handleThreadUpdate(client: Client, oldThread: ThreadChannel, newThread: ThreadChannel): Promise<void> {
  if (!newThread.guild) return
  const diffs = [
    diffLine("Nom", oldThread.name, newThread.name),
    diffLine("Archivé", oldThread.archived ? "Oui" : "Non", newThread.archived ? "Oui" : "Non"),
    diffLine("Verrouillé", oldThread.locked ? "Oui" : "Non", newThread.locked ? "Oui" : "Non"),
  ].filter((line): line is string => Boolean(line))
  if (!diffs.length) return
  const embed = buildLogEmbed(
    "🧵",
    "Fil modifié",
    `> ***Fil :** ${channelLine(newThread.id)}\n${diffs.join("\n")}`,
    colors.yel
  )
  await emit(client, newThread.guild.id, "threads", embed, { channelId: newThread.id, skipLogChannel: true })
}
