import {
  EmbedBuilder,
  type Client,
  type ColorResolvable,
  type Guild,
  type GuildMember,
  type MessageCreateOptions,
  type PartialGuildMember,
  type User,
} from "discord.js"
import { colors } from "../../config.js"
import {
  getConfig,
  type AeroportConfig,
  type FooterIcon,
  type MediaSource,
  type MessageTemplate,
} from "./schema.js"

export interface MessageContext {
  user: User
  member: GuildMember | PartialGuildMember | null
  guild: Guild
}

export function buildAeroportEmbed(
  emoji: string,
  title: string,
  desc: string,
  color: `#${string}` | null = colors.prime
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(" ").setDescription(`# \`${emoji}\` 〃 ${title}\n${desc}`)
  if (color) embed.setColor(color)
  return embed
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function discordDate(ts: number | null | undefined): string {
  if (!ts) return "—"
  return `<t:${Math.floor(ts / 1000)}:D>`
}

function userTag(user: User): string {
  return user.discriminator && user.discriminator !== "0" ? `${user.username}#${user.discriminator}` : user.username
}

function displayName(ctx: MessageContext): string {
  return ctx.member?.displayName ?? ctx.user.globalName ?? ctx.user.username
}

export function interpolate(template: string, ctx: MessageContext): string {
  if (!template) return ""
  const replacements: Record<string, string> = {
    "{user}": `<@${ctx.user.id}>`,
    "{user.name}": displayName(ctx),
    "{user.tag}": userTag(ctx.user),
    "{user.id}": ctx.user.id,
    "{user.username}": ctx.user.username,
    "{member.displayName}": displayName(ctx),
    "{server}": ctx.guild.name,
    "{server.name}": ctx.guild.name,
    "{server.id}": ctx.guild.id,
    "{memberCount}": String(ctx.guild.memberCount),
    "{createdAt}": discordDate(ctx.user.createdTimestamp),
    "{joinedAt}": discordDate(ctx.member?.joinedTimestamp),
  }
  let result = template
  for (const [token, value] of Object.entries(replacements)) {
    result = result.split(token).join(value)
  }
  return result
}

export function parseOptionalColor(value: string | null | undefined): `#${string}` | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed as `#${string}`
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}` as `#${string}`
  return null
}

function resolveMedia(source: MediaSource, url: string | null, ctx: MessageContext): string | null {
  if (source === "none") return null
  if (source === "avatar") return ctx.user.displayAvatarURL({ size: 256, extension: "png" })
  if (source === "server") return ctx.guild.iconURL({ size: 256, extension: "png" })
  if (source === "url") {
    const interpolated = interpolate(url ?? "", ctx).trim()
    return interpolated.length > 0 ? interpolated : null
  }
  return null
}

function resolveFooterIcon(source: FooterIcon, ctx: MessageContext): string | undefined {
  if (source === "avatar") return ctx.user.displayAvatarURL({ size: 64, extension: "png" })
  if (source === "server") return ctx.guild.iconURL({ size: 64, extension: "png" }) ?? undefined
  return undefined
}

function buildEmbed(template: MessageTemplate, ctx: MessageContext): EmbedBuilder | null {
  const settings = template.embed
  if (!settings.enabled) return null

  const title = interpolate(settings.title, ctx).trim()
  const description = interpolate(settings.description, ctx).trim()
  const footer = interpolate(settings.footer, ctx).trim()
  const thumbnail = resolveMedia(settings.thumbnail, settings.thumbnailUrl, ctx)
  const image = resolveMedia(settings.image, settings.imageUrl, ctx)
  const hasAuthor = settings.author
  const hasBody = title.length > 0 || description.length > 0 || Boolean(thumbnail) || Boolean(image) || footer.length > 0 || hasAuthor
  if (!hasBody) return null

  const embed = new EmbedBuilder()
  if (title) embed.setTitle(clip(title, 256))
  if (description) embed.setDescription(clip(description, 4096))
  const color = parseOptionalColor(settings.color) ?? colors.prime
  if (color) embed.setColor(color as ColorResolvable)
  if (thumbnail) embed.setThumbnail(thumbnail)
  if (image) embed.setImage(image)
  if (footer) embed.setFooter({ text: clip(footer, 2048), iconURL: resolveFooterIcon(settings.footerIcon, ctx) })
  if (hasAuthor) {
    embed.setAuthor({
      name: clip(displayName(ctx), 256),
      iconURL: ctx.user.displayAvatarURL({ size: 64, extension: "png" }),
    })
  }
  if (settings.timestamp) embed.setTimestamp()
  return embed
}

export function buildMessagePayload(template: MessageTemplate, ctx: MessageContext): MessageCreateOptions | null {
  const content = interpolate(template.content, ctx).trim()
  const embed = buildEmbed(template, ctx)
  if (!content && !embed) return null
  const payload: MessageCreateOptions = {}
  if (content) payload.content = clip(content, 2000)
  if (embed) payload.embeds = [embed]
  return payload
}

async function resolveTextChannel(guild: Guild, channelId: string) {
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null))
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !channel.isSendable()) return null
  return channel
}

export async function sendTemplate(
  guild: Guild,
  channelId: string | null,
  template: MessageTemplate,
  ctx: MessageContext
): Promise<boolean> {
  if (!channelId) return false
  const payload = buildMessagePayload(template, ctx)
  if (!payload) return false
  const channel = await resolveTextChannel(guild, channelId)
  if (!channel) return false
  try {
    await channel.send(payload)
    return true
  } catch (error) {
    console.error(`Failed to send airport message in guild ${guild.id} channel ${channelId}:`, error)
    return false
  }
}

export async function applyAutoroles(member: GuildMember, roleIds: string[]): Promise<void> {
  if (roleIds.length === 0) return
  const me = member.guild.members.me
  if (!me?.permissions.has("ManageRoles")) return
  const toAdd = roleIds.filter((id) => {
    if (id === member.guild.id) return false
    const role = member.guild.roles.cache.get(id)
    if (!role || role.managed) return false
    if (role.position >= me.roles.highest.position) return false
    return !member.roles.cache.has(id)
  })
  if (toAdd.length === 0) return
  await member.roles.add(toAdd, "Aéroport — autorole").catch((error) => {
    console.error(`Failed to apply airport autoroles in guild ${member.guild.id}:`, error)
  })
}

export function contextFromMember(member: GuildMember | PartialGuildMember): MessageContext | null {
  const user = member.user
  if (!user) return null
  return { user: user as User, member, guild: member.guild }
}

export async function handleMemberJoin(_client: Client, member: GuildMember): Promise<void> {
  let config: AeroportConfig
  try {
    config = await getConfig(member.guild.id)
  } catch (error) {
    console.error(`Failed to load airport config for guild ${member.guild.id}:`, error)
    return
  }

  if (config.ignoreBots && member.user.bot) return
  const ctx = contextFromMember(member)
  if (!ctx) return

  if (config.arrival.enabled) {
    await sendTemplate(member.guild, config.arrival.channelId, config.arrival.template, ctx)
  }

  if (config.dm.enabled) {
    const payload = buildMessagePayload(config.dm.template, ctx)
    if (payload) {
      await member.send(payload).catch(() => undefined)
    }
  }

  await applyAutoroles(member, config.autoroles)
}

export async function handleMemberLeave(_client: Client, member: GuildMember | PartialGuildMember): Promise<void> {
  let config: AeroportConfig
  try {
    config = await getConfig(member.guild.id)
  } catch (error) {
    console.error(`Failed to load airport config for guild ${member.guild.id}:`, error)
    return
  }

  const user = member.user
  if (!user) return
  if (config.ignoreBots && user.bot) return
  if (!config.departure.enabled) return

  const ctx = contextFromMember(member)
  if (!ctx) return
  await sendTemplate(member.guild, config.departure.channelId, config.departure.template, ctx)
}
