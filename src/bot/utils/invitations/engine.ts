import { EmbedBuilder, type Client, type Guild, type GuildMember, type Invite, type PartialGuildMember } from "discord.js"
import { colors } from "../../config.js"
import { appEmojiHeading, type AppEmojiName } from "../appEmojis.js"
import {
  VANITY_CODE,
  getConfig,
  getJoinRecord,
  getMemberInvites,
  incrementInviter,
  inviteTotal,
  upsertJoin,
  type InvitationsConfig,
  type InviteStats,
} from "./schema.js"

function buildLogEmbed(
  name: AppEmojiName,
  title: string,
  desc: string,
  color: `#${string}` | null = colors.prime
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(" ").setDescription(`${appEmojiHeading(name, title)}\n${desc}`)
  if (color) embed.setColor(color)
  return embed
}

const VANITY_KEY = "__vanity__"

interface CachedInvite {
  uses: number
  inviterId: string | null
}

interface UsedInvite {
  code: string
  uses: number
  inviterId: string | null
}

const inviteCache = new Map<string, Map<string, CachedInvite>>()
const deletedInvites = new Map<string, Map<string, CachedInvite & { ts: number }>>()
const guildQueues = new Map<string, Promise<void>>()
const DELETED_TTL = 15_000

function enqueue(guildId: string, task: () => Promise<void>): Promise<void> {
  const prev = guildQueues.get(guildId) ?? Promise.resolve()
  const next = prev.then(task, task)
  guildQueues.set(guildId, next.then(() => undefined, () => undefined))
  return next
}

function userLine(userId: string | null | undefined): string {
  return userId ? `<@${userId}>` : "*Inconnu*"
}

async function sendInviteLog(_client: Client, guild: Guild, embed: EmbedBuilder): Promise<void> {
  try {
    const config = await getConfig(guild.id)
    if (!config.logChannelId) return
    const channel = guild.channels.cache.get(config.logChannelId) ?? (await guild.channels.fetch(config.logChannelId).catch(() => null))
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !channel.isSendable()) return
    await channel.send({ embeds: [embed] })
  } catch (error) {
    console.error(`Failed to send invite log in guild ${guild.id}:`, error)
  }
}

export async function applyRewardRoles(member: GuildMember, config: InvitationsConfig, stats?: InviteStats): Promise<void> {
  if (config.rewards.length === 0) return
  const resolved = stats ?? (await getMemberInvites(member.guild.id, member.id))
  const total = inviteTotal(resolved)
  const earned = config.rewards.filter((item) => total >= item.invites).sort((a, b) => a.invites - b.invites)
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
    await member.roles.add(toAdd, "Invitations — rôle de récompense").catch((error) => {
      console.error(`Failed to add invite rewards in guild ${member.guild.id}:`, error)
    })
  }
  if (toRemove.length) {
    await member.roles.remove(toRemove, "Invitations — rôle de récompense").catch((error) => {
      console.error(`Failed to remove invite rewards in guild ${member.guild.id}:`, error)
    })
  }
}

async function refreshInviterRoles(guild: Guild, inviterId: string, config: InvitationsConfig): Promise<void> {
  const member = guild.members.cache.get(inviterId) ?? (await guild.members.fetch(inviterId).catch(() => null))
  if (!member) return
  await applyRewardRoles(member, config)
}

async function snapshotGuild(guild: Guild): Promise<Map<string, CachedInvite>> {
  const map = new Map<string, CachedInvite>()
  try {
    const invites = await guild.invites.fetch()
    for (const invite of invites.values()) {
      map.set(invite.code, {
        uses: invite.uses ?? 0,
        inviterId: invite.inviterId ?? invite.inviter?.id ?? null,
      })
    }
  } catch (error) {
    console.warn(`Failed to fetch invites in guild ${guild.id}:`, error)
  }
  if (guild.vanityURLCode) {
    try {
      const vanity = await guild.fetchVanityData()
      map.set(VANITY_KEY, { uses: vanity.uses ?? 0, inviterId: null })
    } catch {
      /* vanity fetch needs Manage Guild */
    }
  }
  return map
}

export async function cacheGuild(guild: Guild): Promise<void> {
  inviteCache.set(guild.id, await snapshotGuild(guild))
}

export function dropGuildCache(guildId: string): void {
  inviteCache.delete(guildId)
  deletedInvites.delete(guildId)
}

function rememberDeleted(guildId: string, code: string, data: CachedInvite): void {
  let map = deletedInvites.get(guildId)
  if (!map) {
    map = new Map()
    deletedInvites.set(guildId, map)
  }
  map.set(code, { ...data, ts: Date.now() })
}

function takeRecentlyDeleted(guildId: string): Map<string, CachedInvite> {
  const map = deletedInvites.get(guildId)
  const out = new Map<string, CachedInvite>()
  if (!map) return out
  const now = Date.now()
  for (const [code, item] of map) {
    if (now - item.ts > DELETED_TTL) {
      map.delete(code)
      continue
    }
    out.set(code, { uses: item.uses, inviterId: item.inviterId })
  }
  return out
}

export async function initInviteCache(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      await cacheGuild(guild)
    } catch (error) {
      console.warn(`Failed to cache invites for guild ${guild.id}:`, error)
    }
  }
}

export async function handleInviteCreate(_client: Client, invite: Invite): Promise<void> {
  const guild = invite.guild
  if (!guild || !("id" in guild)) return
  await enqueue(guild.id, async () => {
    const cached = inviteCache.get(guild.id) ?? new Map()
    cached.set(invite.code, {
      uses: invite.uses ?? 0,
      inviterId: invite.inviterId ?? invite.inviter?.id ?? null,
    })
    inviteCache.set(guild.id, cached)
  })
}

export async function handleInviteDelete(_client: Client, invite: Invite): Promise<void> {
  const guild = invite.guild
  if (!guild || !("id" in guild)) return
  await enqueue(guild.id, async () => {
    const cached = inviteCache.get(guild.id)
    const prev = cached?.get(invite.code)
    rememberDeleted(guild.id, invite.code, {
      uses: invite.uses ?? prev?.uses ?? 0,
      inviterId: invite.inviterId ?? invite.inviter?.id ?? prev?.inviterId ?? null,
    })
    cached?.delete(invite.code)
  })
}

async function resolveUsedInvite(guild: Guild): Promise<UsedInvite | null> {
  const cached = new Map(inviteCache.get(guild.id) ?? [])
  for (const [code, item] of takeRecentlyDeleted(guild.id)) {
    if (!cached.has(code)) cached.set(code, item)
  }
  const next = new Map<string, CachedInvite>()
  let used: UsedInvite | null = null

  try {
    const invites = await guild.invites.fetch()
    for (const invite of invites.values()) {
      const uses = invite.uses ?? 0
      const inviterId = invite.inviterId ?? invite.inviter?.id ?? null
      const prev = cached.get(invite.code)
      if (!used && uses > (prev?.uses ?? 0)) {
        used = { code: invite.code, uses, inviterId }
      }
      next.set(invite.code, { uses, inviterId })
    }
  } catch (error) {
    console.warn(`Failed to fetch invites on join in guild ${guild.id}:`, error)
    return null
  }

  if (guild.vanityURLCode) {
    try {
      const vanity = await guild.fetchVanityData()
      const uses = vanity.uses ?? 0
      const prev = cached.get(VANITY_KEY)
      if (!used && uses > (prev?.uses ?? 0)) {
        used = { code: VANITY_CODE, uses, inviterId: null }
      }
      next.set(VANITY_KEY, { uses, inviterId: null })
    } catch {
      const prev = cached.get(VANITY_KEY)
      if (prev) next.set(VANITY_KEY, prev)
    }
  }

  if (!used) {
    for (const [code, prev] of cached) {
      if (code === VANITY_KEY) continue
      if (!next.has(code)) {
        used = { code, uses: prev.uses + 1, inviterId: prev.inviterId }
        deletedInvites.get(guild.id)?.delete(code)
        break
      }
    }
  } else {
    deletedInvites.get(guild.id)?.delete(used.code === VANITY_CODE ? VANITY_KEY : used.code)
  }

  inviteCache.set(guild.id, next)
  return used
}

function inviteKind(rejoin: boolean, fake: boolean, used: UsedInvite | null): string {
  if (rejoin) return "Rejoin"
  if (!used) return "Inconnu"
  if (used.code === VANITY_CODE) return "Vanity"
  if (fake) return "Fake"
  return "Régulière"
}

export async function handleMemberJoin(client: Client, member: GuildMember): Promise<void> {
  let config: InvitationsConfig
  try {
    config = await getConfig(member.guild.id)
  } catch (error) {
    console.error(`Failed to load invitations config in guild ${member.guild.id}:`, error)
    return
  }
  if (!config.enabled) return
  if (member.user.bot && config.ignoreBots) return

  try {
    await enqueue(member.guild.id, async () => {
      const used = await resolveUsedInvite(member.guild)
      const existing = await getJoinRecord(member.guild.id, member.id)
      const rejoin = existing !== null
      const accountAge = Date.now() - member.user.createdTimestamp
      const fake =
        (config.fakeAge > 0 && accountAge < config.fakeAge) || Boolean(used?.inviterId && used.inviterId === member.id)

      const record = {
        guildId: member.guild.id,
        userId: member.id,
        inviterId: used?.inviterId ?? null,
        code: used?.code ?? null,
        fake,
        joinedAt: Date.now(),
        leftAt: null,
      }

      if (rejoin && !config.countRejoins) {
        await upsertJoin({
          ...record,
          inviterId: existing.inviterId ?? record.inviterId,
          code: existing.code ?? record.code,
          fake: existing.fake,
          joinedAt: existing.joinedAt,
        })
      } else {
        if (used?.inviterId) {
          const stats = await incrementInviter(member.guild.id, used.inviterId, fake ? "fake" : "regular")
          const inviter =
            member.guild.members.cache.get(used.inviterId) ??
            (await member.guild.members.fetch(used.inviterId).catch(() => null))
          if (inviter) await applyRewardRoles(inviter, config, stats)
        }
        await upsertJoin(record)
      }

      const inviterLabel =
        used?.code === VANITY_CODE ? "*URL vanity*" : used?.inviterId ? `<@${used.inviterId}>` : "*Inconnu*"
      const embed = buildLogEmbed(
        "add",
        "Membre arrivé",
        `> ***Membre :** ${userLine(member.id)}*\n` +
          `> ***Invité par :** ${inviterLabel}*\n` +
          `> ***Code :** \`${used?.code ?? "inconnu"}\`*\n` +
          `> ***Utilisations :** \`${used?.uses ?? "?"}\`*\n` +
          `> ***Type :** \`${inviteKind(rejoin && !config.countRejoins, fake, used)}\`*\n` +
          `> ***Compte créé :** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>*`,
        fake ? colors.orng : colors.prime
      )
      await sendInviteLog(client, member.guild, embed)
    })
  } catch (error) {
    console.error(`Failed to handle invite join in guild ${member.guild.id}:`, error)
  }
}

export async function handleMemberLeave(client: Client, member: GuildMember | PartialGuildMember): Promise<void> {
  let config: InvitationsConfig
  try {
    config = await getConfig(member.guild.id)
  } catch (error) {
    console.error(`Failed to load invitations config in guild ${member.guild.id}:`, error)
    return
  }
  if (!config.enabled) return

  const user = member.user
  if (user?.bot && config.ignoreBots) return

  try {
    await enqueue(member.guild.id, async () => {
      const existing = await getJoinRecord(member.guild.id, member.id)
      if (!existing || existing.leftAt) return

      await upsertJoin({ ...existing, leftAt: Date.now() })
      if (existing.inviterId) {
        await incrementInviter(member.guild.id, existing.inviterId, "left")
        await refreshInviterRoles(member.guild, existing.inviterId, config)
      }

      const inviterLabel =
        existing.code === VANITY_CODE ? "*URL vanity*" : existing.inviterId ? `<@${existing.inviterId}>` : "*Inconnu*"
      const embed = buildLogEmbed(
        "cancel",
        "Membre parti",
        `> ***Membre :** ${userLine(member.id)}*\n` +
          `> ***Invité par :** ${inviterLabel}*\n` +
          `> ***Code :** \`${existing.code ?? "inconnu"}\`*`,
        colors.orng
      )
      await sendInviteLog(client, member.guild, embed)
    })
  } catch (error) {
    console.error(`Failed to handle invite leave in guild ${member.guild.id}:`, error)
  }
}
