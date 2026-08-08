import {
  AuditLogEvent,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type User,
} from "discord.js"
import { colors } from "../../config.js"
import formatTime from "../formatTime.js"
import { banUsers, dmUser, kickMembers, punishMember, timeoutMembers } from "./punish.js"
import { buildAntiRaidEmbed, sendLog } from "./logs.js"
import {
  AntiRaid,
  PUNISHMENT_LABELS,
  getConfig,
  type AntiRaidConfig,
  type ModuleSettings,
} from "./schema.js"

const LINK_REGEX = /https?:\/\/[^\s<>]+/gi
const INVITE_REGEX = /(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-zA-Z0-9_-]+/gi
const EMOJI_REGEX = /<a?:[a-zA-Z0-9_]+:[0-9]+>/gi

const CONFIG_CACHE_TTL = 5_000
const PUNISH_COOLDOWN = 60_000
const RAID_COOLDOWN = 120_000
const CLEANUP_INTERVAL = 60_000
const MAX_PURGE_PER_CHANNEL = 100

const AUDIT_ACTIONS = {
  channelCreate: AuditLogEvent.ChannelCreate,
  channelDelete: AuditLogEvent.ChannelDelete,
  roleCreate: AuditLogEvent.RoleCreate,
  roleDelete: AuditLogEvent.RoleDelete,
  ban: AuditLogEvent.MemberBanAdd,
}

interface TrackedMessage {
  id: string
  content: string
  channelId: string
  ts: number
}

interface TrackedMember {
  userId: string
  ts: number
}

interface TrackedAction {
  type: string
  target: string
  ts: number
}

interface PendingVerification {
  guildId: string
  userId: string
  code: string
  expires: number
}

class ListTracker<T extends { ts: number }> {
  private entries = new Map<string, T[]>()

  push(key: string, value: T) {
    const list = this.entries.get(key) ?? []
    list.push(value)
    this.entries.set(key, list.slice(-60))
  }

  recent(key: string, within: number): T[] {
    const now = Date.now()
    const list = (this.entries.get(key) ?? []).filter((item) => now - item.ts <= within)
    this.entries.set(key, list)
    return list
  }

  cleanup(now: number) {
    for (const [key, list] of this.entries) {
      const filtered = list.filter((item) => now - item.ts <= 60_000)
      if (filtered.length === 0) this.entries.delete(key)
      else this.entries.set(key, filtered)
    }
  }
}

class RateTracker {
  private entries = new Map<string, number[]>()

  push(key: string, ts = Date.now()) {
    const list = this.entries.get(key) ?? []
    list.push(ts)
    this.entries.set(key, list.slice(-200))
  }

  count(key: string, within: number): number {
    const now = Date.now()
    const list = (this.entries.get(key) ?? []).filter((ts) => now - ts <= within)
    this.entries.set(key, list)
    return list.length
  }

  cleanup(now: number) {
    for (const [key, list] of this.entries) {
      const filtered = list.filter((ts) => now - ts <= 60_000)
      if (filtered.length === 0) this.entries.delete(key)
      else this.entries.set(key, filtered)
    }
  }
}

export class AntiRaidEngine {
  private client: Client
  private configCache = new Map<string, { config: AntiRaidConfig; expires: number }>()
  private cooldowns = new Map<string, number>()
  private raidCooldowns = new Map<string, number>()
  private recentActions = new Map<string, number>()
  private ownBans = new Map<string, number>()

  private messages = new ListTracker<TrackedMessage>()
  private joins = new ListTracker<TrackedMember>()
  private botJoins = new ListTracker<TrackedMember>()
  private destructive = new ListTracker<TrackedAction>()
  private rates = new RateTracker()

  private pendingVerify = new Map<string, PendingVerification>()

  constructor(client: Client) {
    this.client = client
    setInterval(() => this.cleanup(), CLEANUP_INTERVAL).unref()
  }

  async getConfig(guildId: string): Promise<AntiRaidConfig> {
    const cached = this.configCache.get(guildId)
    if (cached && cached.expires > Date.now()) return cached.config

    const config = await getConfig(guildId)
    this.configCache.set(guildId, { config, expires: Date.now() + CONFIG_CACHE_TTL })
    return config
  }

  invalidateConfig(guildId: string) {
    this.configCache.delete(guildId)
  }

  isWhitelisted(config: AntiRaidConfig, member: GuildMember | null | undefined, opts?: { admin?: boolean }): boolean {
    if (!member) return false
    if (member.id === member.guild.ownerId) return true
    if (config.whitelistedUsers.includes(member.id)) return true
    if (member.roles.cache.some((role) => config.whitelistedRoles.includes(role.id))) return true
    if (opts?.admin !== false && member.permissions.has(PermissionFlagsBits.Administrator)) return true
    return false
  }

  private anyModuleEnabled(config: AntiRaidConfig): boolean {
    return Object.values(config.modules).some((module) => module.enabled)
  }

  private setCooldown(guildId: string, userId: string, ms: number) {
    this.cooldowns.set(`${guildId}:${userId}`, Date.now() + ms)
  }

  private isCooldown(guildId: string, userId: string): boolean {
    const until = this.cooldowns.get(`${guildId}:${userId}`)
    return until !== undefined && until > Date.now()
  }

  private setRaidCooldown(guildId: string, module: string, ms: number) {
    this.raidCooldowns.set(`${guildId}:${module}`, Date.now() + ms)
  }

  private isRaidCooldown(guildId: string, module: string): boolean {
    const until = this.raidCooldowns.get(`${guildId}:${module}`)
    return until !== undefined && until > Date.now()
  }

  private markOwnBan(guildId: string, userId: string) {
    this.ownBans.set(`${guildId}:${userId}`, Date.now())
  }

  private isOwnBan(guildId: string, userId: string): boolean {
    const ts = this.ownBans.get(`${guildId}:${userId}`)
    return ts !== undefined && Date.now() - ts <= 120_000
  }

  async handleMessage(client: Client, message: Message) {
    const guild = message.guild
    if (!guild || message.author.bot) return

    const config = await this.getConfig(guild.id)
    if (!config.enabled) return
    if (this.anyModuleEnabled(config) === false && !config.raidMode) return
    if (await this.checkRaidModeExpiry(client, config)) return

    const member = message.member
    if (!member) return

    if (config.raidMode && Date.now() < config.raidEndsAt) {
      if (this.isWhitelisted(config, member)) return
      try {
        await message.delete()
      } catch {}
      if (this.isCooldown(guild.id, member.id)) return
      this.setCooldown(guild.id, member.id, 10_000)
      const duration = Math.max(config.raidDuration, 60_000)
      const result = await punishMember(client, member, "timeout", duration, "Serveur verrouillé : mode raid actif.")
      await sendLog(
        client,
        guild.id,
        buildAntiRaidEmbed(
          "🔒",
          "Mode raid",
          `> ***Membre:** <@${member.id}> (${member.user.tag})*\n> *A tenté d'envoyer un message alors que le serveur est verrouillé.*\n> ***Action:** ${result.label}${result.note ? ` — ${result.note}` : ""}*`,
          colors.orng
        )
      )
      return
    }

    if (this.isWhitelisted(config, member)) return

    const userKey = `${guild.id}:${member.id}`
    this.messages.push(userKey, {
      id: message.id,
      content: message.content,
      channelId: message.channel.id,
      ts: Date.now(),
    })

    const spam = config.modules.spam
    if (spam.enabled) {
      const recent = this.messages.recent(userKey, spam.interval)
      const contents = recent.map((entry) => entry.content.toLowerCase().replace(/\s+/g, " ").trim())
      const distinct = new Set(contents).size
      const flood = recent.length >= spam.limit && distinct >= Math.ceil(recent.length / 2)
      const dupe = recent.length >= spam.limit && distinct <= 2
      if (flood || dupe) {
        await this.punishMessageOffender(
          client,
          message,
          config,
          spam,
          userKey,
          "Anti-Spam",
          dupe ? "Messages dupliqués" : "Flood de messages"
        )
        return
      }
    }

    const mentions = config.modules.mentions
    if (mentions.enabled) {
      const mentionCount =
        message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0)
      if (mentionCount > 0) {
        this.rates.push(`mentions:${userKey}`)
        const count = this.rates.count(`mentions:${userKey}`, mentions.interval)
        if (count >= mentions.limit) {
          await this.punishMessageOffender(
            client,
            message,
            config,
            mentions,
            userKey,
            "Anti-Mention",
            `${count} mentions en ${formatTime(mentions.interval)}`
          )
          return
        }
      }
    }

    const links = config.modules.links
    if (links.enabled) {
      const linkCount = (message.content.match(LINK_REGEX) ?? []).length
      const inviteCount = (message.content.match(INVITE_REGEX) ?? []).length
      const total = linkCount + inviteCount
      if (total > 0) {
        this.rates.push(`links:${userKey}`)
        const count = this.rates.count(`links:${userKey}`, links.interval)
        if (count >= links.limit) {
          await this.punishMessageOffender(
            client,
            message,
            config,
            links,
            userKey,
            "Anti-Lien",
            `${count} liens en ${formatTime(links.interval)}`
          )
          return
        }
      }
    }

    const emojis = config.modules.emojis
    if (emojis.enabled) {
      const emojiCount = (message.content.match(EMOJI_REGEX) ?? []).length + message.stickers.size
      if (emojiCount > 0) {
        this.rates.push(`emojis:${userKey}`)
        const count = this.rates.count(`emojis:${userKey}`, emojis.interval)
        if (count >= emojis.limit) {
          await this.punishMessageOffender(
            client,
            message,
            config,
            emojis,
            userKey,
            "Anti-Émoji",
            `${count} emojis/stickers en ${formatTime(emojis.interval)}`
          )
          return
        }
      }
    }

    const selfbots = config.modules.selfbots
    if (selfbots.enabled && message.embeds.length > 0) {
      this.rates.push(`selfbots:${userKey}`)
      const count = this.rates.count(`selfbots:${userKey}`, selfbots.interval)
      if (count >= selfbots.limit) {
        await this.punishMessageOffender(
          client,
          message,
          config,
          selfbots,
          userKey,
          "Anti-Selfbot",
          `${count} messages avec embeds personnalisés en ${formatTime(selfbots.interval)}`
        )
      }
    }
  }

  private async punishMessageOffender(
    client: Client,
    message: Message,
    config: AntiRaidConfig,
    settings: ModuleSettings,
    userKey: string,
    moduleLabel: string,
    detection: string
  ) {
    const member = message.member
    if (!member) return
    const guild = message.guild
    if (!guild) return

    if (this.isCooldown(guild.id, member.id)) {
      try {
        await message.delete()
      } catch {}
      return
    }

    const reason = `Anti-Raid (${moduleLabel}) : ${detection} sur ${guild.name}`
    if (["timeout", "kick", "ban"].includes(settings.punishment)) {
      await this.purgeMessages(client, guild, userKey)
    }

    if (settings.punishment === "lockdown") {
      await this.activateRaidMode(client, config, settings.duration)
      this.setCooldown(guild.id, member.id, RAID_COOLDOWN)
      await sendLog(
        client,
        guild.id,
        buildAntiRaidEmbed(
          "🚨",
          moduleLabel,
          `> ***Déclenché par:** <@${member.id}> (${member.user.tag})*\n> ***Détection:** ${detection}*\n> ***Action:** Verrouillage du serveur*`,
          colors.red
        )
      )
      return
    }

    const result = await punishMember(client, member, settings.punishment, settings.duration, reason)
    this.setCooldown(guild.id, member.id, PUNISH_COOLDOWN)
    await sendLog(
      client,
      guild.id,
      buildAntiRaidEmbed(
        "🚨",
        moduleLabel,
        `> ***Utilisateur:** <@${member.id}> (${member.user.tag})*\n> ***Détection:** ${detection}*\n> ***Punition:** ${result.label}${result.note ? ` — ${result.note}` : ""}*\n> ***Raison:** ${reason}*`,
        colors.red
      )
    )
  }

  private async purgeMessages(client: Client, guild: Guild, userKey: string) {
    const me = guild.members.me
    if (!me || !me.permissions.has(PermissionFlagsBits.ManageMessages)) return

    const recent = this.messages.recent(userKey, 60_000)
    const byChannel = new Map<string, string[]>()
    for (const entry of recent) {
      const ids = byChannel.get(entry.channelId) ?? []
      ids.push(entry.id)
      byChannel.set(entry.channelId, ids)
    }

    for (const [channelId, ids] of byChannel) {
      const channel = client.channels.cache.get(channelId)
      if (!channel || !("guild" in channel)) continue
      if (!channel.isTextBased()) continue
      if (!me.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages)) continue
      try {
        await channel.bulkDelete(ids.slice(0, MAX_PURGE_PER_CHANNEL))
      } catch (error) {
        console.error(`Failed to purge messages in channel ${channelId}:`, error)
      }
    }
  }

  async handleMemberJoin(client: Client, member: GuildMember) {
    const guild = member.guild
    const config = await this.getConfig(guild.id)
    if (!config.enabled) return
    if (this.anyModuleEnabled(config) === false) return

    const joins = config.modules.joins
    if (joins.enabled) {
      this.joins.push(guild.id, { userId: member.id, ts: Date.now() })
      const recent = this.joins.recent(guild.id, joins.interval)
      if (recent.length >= joins.limit) {
        await this.handleJoinRaid(client, guild, config, joins, recent)
        return
      }
    }

    const bots = config.modules.bots
    if (member.user.bot && bots.enabled) {
      this.botJoins.push(guild.id, { userId: member.id, ts: Date.now() })
      const recent = this.botJoins.recent(guild.id, bots.interval)
      if (recent.length >= bots.limit) {
        await this.handleBotRaid(client, guild, config, bots, recent)
      }
    }

    const alts = config.modules.alts
    if (alts.enabled && config.premium) {
      const createdAt = member.user.createdTimestamp
      if (createdAt && Date.now() - createdAt < alts.maxAge) {
        if (this.isCooldown(guild.id, member.id)) return
        const reason = `Anti-Alts : compte créé il y a ${formatTime(Date.now() - createdAt)}`
        const result = await punishMember(client, member, alts.punishment, alts.duration, reason)
        this.setCooldown(guild.id, member.id, PUNISH_COOLDOWN)
        await sendLog(
          client,
          guild.id,
          buildAntiRaidEmbed(
            "🚨",
            "Anti-Alts",
            `> ***Utilisateur:** <@${member.id}> (${member.user.tag})*\n> ***Compte créé:** <t:${Math.floor(createdAt / 1000)}:R>*\n> ***Punition:** ${result.label}${result.note ? ` — ${result.note}` : ""}*`,
            colors.red
          )
        )
      }
    }

    const verify = config.modules.verify
    if (verify.enabled && config.premium) {
      await this.startVerification(client, member, config, verify)
    }
  }

  private async handleJoinRaid(
    client: Client,
    guild: Guild,
    config: AntiRaidConfig,
    settings: ModuleSettings,
    recent: TrackedMember[]
  ) {
    if (this.isRaidCooldown(guild.id, "joins")) return
    this.setRaidCooldown(guild.id, "joins", RAID_COOLDOWN)

    const targets = recent.slice(-settings.limit)
    const reason = `Anti-Raid (flood de membres) : ${targets.length} arrivées en ${formatTime(settings.interval)}`

    if (settings.punishment === "lockdown") {
      await this.activateRaidMode(client, config, settings.duration)
      await sendLog(
        client,
        guild.id,
        buildAntiRaidEmbed(
          "🚨",
          "Raid détecté",
          `> ***${targets.length} membres sont arrivés en ${formatTime(settings.interval)}.***\n> ***Action:** Verrouillage du serveur*`,
          colors.red
        )
      )
      return
    }

    const users = await this.resolveUsers(guild, targets.map((entry) => entry.userId))
    let count = 0
    if (settings.punishment === "ban") {
      count = await banUsers(client, guild, users, reason)
      for (const user of users) this.markOwnBan(guild.id, user.id)
    } else if (settings.punishment === "kick") {
      const members = users
        .map((user) => guild.members.cache.get(user.id))
        .filter((entry): entry is GuildMember => entry !== undefined)
      count = await kickMembers(client, guild, members, reason)
    } else {
      const members = users
        .map((user) => guild.members.cache.get(user.id))
        .filter((entry): entry is GuildMember => entry !== undefined)
      count = await timeoutMembers(client, guild, members, Math.max(settings.duration, 60_000), reason)
    }

    await sendLog(
      client,
      guild.id,
      buildAntiRaidEmbed(
        "🚨",
        "Raid détecté",
        `> ***${targets.length} membres sont arrivés en ${formatTime(settings.interval)}.***\n> ***Punition:** ${PUNISHMENT_LABELS[settings.punishment]}*\n> ***Membres sanctionnés:** ${count}/${targets.length}*`,
        colors.red
      )
    )
  }

  private async handleBotRaid(
    client: Client,
    guild: Guild,
    config: AntiRaidConfig,
    settings: ModuleSettings,
    recent: TrackedMember[]
  ) {
    if (this.isRaidCooldown(guild.id, "bots")) return
    this.setRaidCooldown(guild.id, "bots", RAID_COOLDOWN)

    const targets = recent.slice(-settings.limit)
    const reason = `Anti-Bot : ${targets.length} bots ajoutés en ${formatTime(settings.interval)}`
    const users = await this.resolveUsers(guild, targets.map((entry) => entry.userId))
    const count = await banUsers(client, guild, users, reason)
    for (const user of users) this.markOwnBan(guild.id, user.id)

    await sendLog(
      client,
      guild.id,
      buildAntiRaidEmbed(
        "🤖",
        "Anti-Bot",
        `> ***${targets.length} bots sont arrivés en ${formatTime(settings.interval)}.***\n> ***Bots bannis:** ${count}/${targets.length}*`,
        colors.red
      )
    )
  }

  async handleDestructive(
    client: Client,
    guild: Guild,
    actorId: string | null,
    type: string,
    targetId: string
  ) {
    const config = await this.getConfig(guild.id)
    if (!config.enabled) return

    const settings = config.modules.nuke
    if (!settings.enabled) return
    if (this.isRaidCooldown(guild.id, "nuke")) return
    if (type === "ban" && this.isOwnBan(guild.id, targetId)) return

    const actionKey = `${guild.id}:${type}:${targetId}`
    if (this.recentActions.has(actionKey) && Date.now() - (this.recentActions.get(actionKey) ?? 0) <= 10_000) {
      return
    }
    this.recentActions.set(actionKey, Date.now())

    let resolvedActor = actorId
    if (!resolvedActor) {
      resolvedActor = await this.resolveActorFromAudit(guild, type, targetId)
    }
    if (resolvedActor && resolvedActor === client.user?.id) return

    const actor = resolvedActor ? await this.resolveMember(guild, resolvedActor) : null
    if (actor && this.isWhitelisted(config, actor, { admin: false })) return

    const key = `${guild.id}:${resolvedActor ?? "guild"}`
    this.destructive.push(key, { type, target: targetId, ts: Date.now() })
    const recent = this.destructive.recent(key, settings.interval)
    if (recent.length < settings.limit) return

    const reason = `Anti-Nuke : ${recent.length} actions destructrices en ${formatTime(settings.interval)}`
    const actorUser = actor?.user ?? (resolvedActor ? await this.resolveUser(guild, resolvedActor) : null)
    let measure = ""

    if (settings.punishment === "lockdown") {
      await this.activateRaidMode(client, config, settings.duration)
      if (actorUser) {
        try {
          await guild.members.ban(actorUser, { reason })
          this.markOwnBan(guild.id, actorUser.id)
          measure = "Verrouillage du serveur + bannissement de l'auteur"
        } catch (error) {
          console.error(`Failed to ban nuke culprit ${actorUser.tag} in guild ${guild.id}:`, error)
          measure = "Verrouillage du serveur (bannissement impossible)"
        }
      } else {
        measure = "Verrouillage du serveur"
      }
    } else if (actorUser) {
      const member = actor ?? (await this.resolveMember(guild, actorUser.id))
      if (member) {
        const result = await punishMember(client, member, settings.punishment, settings.duration, reason)
        measure = result.label + (result.note ? ` — ${result.note}` : "")
      } else {
        measure = "Aucune action possible sur l'auteur"
      }
    } else {
      measure = "Aucune action possible"
    }

    this.setRaidCooldown(guild.id, "nuke", RAID_COOLDOWN)
    await sendLog(
      client,
      guild.id,
      buildAntiRaidEmbed(
        "💥",
        "Anti-Nuke",
        `> ***Détection:** ${recent.length} actions destructrices en ${formatTime(settings.interval)}*\n> ***Auteur:** ${actorUser ? `<@${actorUser.id}> (${actorUser.tag})` : "Inconnu (sans permission de journal d'audit)"}*\n> ***Mesure:** ${measure}*`,
        colors.red
      )
    )
  }

  private async resolveActorFromAudit(guild: Guild, type: string, targetId: string): Promise<string | null> {
    const action = AUDIT_ACTIONS[type as keyof typeof AUDIT_ACTIONS]
    if (!action) return null
    try {
      const logs = await guild.fetchAuditLogs({ limit: 5, type: action })
      const entry = logs.entries.find((log) => log.targetId === targetId)
      return entry?.executorId ?? null
    } catch {
      return null
    }
  }

  async activateRaidMode(client: Client, config: AntiRaidConfig, duration: number) {
    if (config.raidMode && Date.now() < config.raidEndsAt) return
    const end = Date.now() + Math.max(duration, 60_000)
    await AntiRaid.findOneAndUpdate(
      { guildId: config.guildId },
      { $set: { raidMode: true, raidEndsAt: end } },
      { upsert: true }
    )
    this.invalidateConfig(config.guildId)

    const guild = client.guilds.cache.get(config.guildId)
    if (!guild) return
    const members = await this.lockdownCandidates(guild, config)
    const count = await timeoutMembers(client, guild, members, end - Date.now(), "Serveur verrouillé : mode raid actif.")
    await sendLog(
      client,
      config.guildId,
      buildAntiRaidEmbed(
        "🔒",
        "Mode raid activé",
        `> *Le serveur est verrouillé jusqu'à <t:${Math.floor(end / 1000)}:T>.*\n> ***Membres placés en exclusion temporaire:** ${count}*`,
        colors.orng
      )
    )
  }

  async deactivateRaidMode(client: Client, config: AntiRaidConfig) {
    await AntiRaid.findOneAndUpdate(
      { guildId: config.guildId },
      { $set: { raidMode: false, raidEndsAt: 0 } }
    )
    this.invalidateConfig(config.guildId)
    await sendLog(
      client,
      config.guildId,
      buildAntiRaidEmbed("🔓", "Mode raid désactivé", "> *Le verrouillage du serveur a été levé.*", colors.yel)
    )
  }

  async checkRaidModeExpiry(client: Client, config: AntiRaidConfig): Promise<boolean> {
    if (!config.raidMode) return false
    if (Date.now() < config.raidEndsAt) return false
    config.raidMode = false
    config.raidEndsAt = 0
    await AntiRaid.findOneAndUpdate(
      { guildId: config.guildId },
      { $set: { raidMode: false, raidEndsAt: 0 } }
    )
    this.invalidateConfig(config.guildId)
    await sendLog(
      client,
      config.guildId,
      buildAntiRaidEmbed("🔓", "Mode raid désactivé", "> *Le verrouillage automatique a expiré, le serveur est de nouveau accessible.*", colors.yel)
    )
    return true
  }

  async isRaidActive(guildId: string): Promise<boolean> {
    const config = await this.getConfig(guildId)
    return config.raidMode && Date.now() < config.raidEndsAt
  }

  private async lockdownCandidates(guild: Guild, config: AntiRaidConfig): Promise<GuildMember[]> {
    let members = [...guild.members.cache.values()]
    if (members.length === 0) {
      try {
        members = [...(await guild.members.fetch()).values()]
      } catch {}
    }

    const candidates: GuildMember[] = []
    for (const member of members) {
      if (candidates.length >= 75) break
      if (member.user.bot) continue
      if (member.id === guild.ownerId) continue
      if (member.permissions.has(PermissionFlagsBits.Administrator)) continue
      if (!member.moderatable) continue
      if (this.isWhitelisted(config, member)) continue
      candidates.push(member)
    }
    return candidates
  }

  private async resolveMember(guild: Guild, userId: string): Promise<GuildMember | null> {
    return guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null))
  }

  private async resolveUser(guild: Guild, userId: string): Promise<User | null> {
    try {
      const member = await this.resolveMember(guild, userId)
      if (member) return member.user
      return await guild.client.users.fetch(userId)
    } catch {
      return null
    }
  }

  private async resolveUsers(guild: Guild, userIds: string[]): Promise<User[]> {
    const users: User[] = []
    for (const userId of userIds) {
      const user = await this.resolveUser(guild, userId)
      if (user) users.push(user)
    }
    return users
  }

  async verifyMember(client: Client, guild: Guild, member: GuildMember, code: string): Promise<boolean> {
    const key = `${guild.id}:${member.id}`
    const entry = this.pendingVerify.get(key)
    if (!entry) return false
    if (Date.now() > entry.expires) {
      this.pendingVerify.delete(key)
      return false
    }
    const supplied = typeof code === "string" ? code.trim().toUpperCase() : ""
    if (entry.code !== supplied) return false

    this.pendingVerify.delete(key)
    try {
      await member.timeout(null, "Vérification réussie")
    } catch {}
    const config = await this.getConfig(guild.id)
    const roleId = config.modules.verify.role
    if (roleId) {
      const role = guild.roles.cache.get(roleId)
      if (role) {
        try {
          await member.roles.add(role, "Vérification réussie")
        } catch {}
      }
    }
    await sendLog(
      client,
      guild.id,
      buildAntiRaidEmbed("✅", "Vérification réussie", `> ***Membre:** <@${member.id}> (${member.user.tag})*`, colors.yel)
    )
    return true
  }

  private async startVerification(client: Client, member: GuildMember, config: AntiRaidConfig, settings: ModuleSettings) {
    const guild = member.guild
    const key = `${guild.id}:${member.id}`
    const code = this.generateCode()
    const expires = Date.now() + Math.max(settings.duration, 60_000)
    this.pendingVerify.set(key, { guildId: guild.id, userId: member.id, code, expires })

    if (member.moderatable) {
      try {
        await member.timeout(expires - Date.now(), "Vérification requise (anti-raid premium)")
      } catch {}
    }

    const dmSent = await dmUser(
      member.user,
      "Vérification requise",
      `> *Pour finir votre arrivée sur **${guild.name}**, veuillez vérifier votre compte.*\n> ***Code:** \`${code}\`*\n> *Tapez \`verify ${code}\` dans le serveur avant <t:${Math.floor(expires / 1000)}:T>.*`
    )

    await sendLog(
      client,
      guild.id,
      buildAntiRaidEmbed(
        "🛂",
        "Vérification requise",
        `> ***Membre:** <@${member.id}> (${member.user.tag})*\n> *Code de vérification envoyé par message privé.*${dmSent ? "" : "\n> *⚠️ Impossible d'envoyer le message privé — le membre pourra être expulsé.*"}`,
        colors.yel
      )
    )
  }

  private generateCode(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    let code = ""
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)]
    }
    return code
  }

  private cleanup() {
    const now = Date.now()
    this.messages.cleanup(now)
    this.joins.cleanup(now)
    this.botJoins.cleanup(now)
    this.destructive.cleanup(now)
    this.rates.cleanup(now)

    for (const [key, until] of this.cooldowns) {
      if (until <= now) this.cooldowns.delete(key)
    }
    for (const [key, until] of this.raidCooldowns) {
      if (until <= now) this.raidCooldowns.delete(key)
    }
    for (const [key, ts] of this.recentActions) {
      if (now - ts > 60_000) this.recentActions.delete(key)
    }
    for (const [key, ts] of this.ownBans) {
      if (now - ts > 120_000) this.ownBans.delete(key)
    }
    for (const [key, entry] of this.pendingVerify) {
      if (now > entry.expires) {
        this.pendingVerify.delete(key)
        void this.expireVerification(entry)
      }
    }
  }

  private async expireVerification(entry: PendingVerification) {
    const guild = this.client.guilds.cache.get(entry.guildId)
    if (!guild) return
    try {
      const member = await guild.members.fetch(entry.userId).catch(() => null)
      if (!member) return
      if (!member.kickable) return
      await member.kick("Vérification expirée (anti-raid premium)")
      await sendLog(
        this.client,
        entry.guildId,
        buildAntiRaidEmbed(
          "⏰",
          "Vérification expirée",
          `> ***Membre expulsé:** <@${entry.userId}>*\n> *Il n'a pas validé la vérification à temps.*`,
          colors.red
        )
      )
    } catch (error) {
      console.error(`Failed to expire verification for ${entry.userId}:`, error)
    }
  }
}
