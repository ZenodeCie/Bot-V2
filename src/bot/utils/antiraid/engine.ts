import {
  AuditLogEvent,
  ChannelType,
  PermissionFlagsBits,
  type Channel,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type Role,
  type User,
} from "discord.js"
import { colors } from "../../config.js"
import formatTime from "../formatTime.js"
import { banUsers, kickMembers, punishMember, timeoutMembers } from "./punish.js"
import { buildAntiRaidEmbed, sendLog } from "./logs.js"
import {
  AntiRaid,
  MODE_PRESETS,
  PUNISHMENT_LABELS,
  getConfig,
  type AntiRaidConfig,
  type AntiRaidMode,
  type ModuleName,
  type ModuleSettings,
} from "./schema.js"

const LINK_REGEX = /https?:\/\/[^\s<>]+/gi
const INVITE_REGEX = /(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-zA-Z0-9_-]+/gi
const EMOJI_REGEX = /<a?:[a-zA-Z0-9_]+:[0-9]+>/gi

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

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

interface EventEntry {
  guildId: string
  type: string
  detail?: string
  ts: number
}

interface SuspectEntry {
  userId: string
  score: number
  ts: number
}

interface ChannelSnapshot {
  id: string
  name: string
  type: ChannelType
  parentId: string | null
  topic: string | null
  nsfw: boolean
}

interface RoleSnapshot {
  id: string
  name: string
  color: number
  hoist: boolean
  mentionable: boolean
  permissions: string
  position: number
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

  keys(): string[] {
    return [...this.entries.keys()]
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

  private eventLog = new Map<string, EventEntry[]>()
  private suspects = new Map<string, SuspectEntry[]>()
  private channelSnapshots = new Map<string, ChannelSnapshot>()
  private roleSnapshots = new Map<string, RoleSnapshot>()

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
          "power",
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

    if (config.honeypot.enabled) {
      const inHoneypotChannel = config.honeypot.channels.includes(message.channel.id)
      const hasHoneypotRole = config.honeypot.roles.some((roleId) => member.roles.cache.has(roleId))
      if (inHoneypotChannel || hasHoneypotRole) {
        if (this.isCooldown(guild.id, member.id)) {
          try {
            await message.delete()
          } catch {}
          return
        }
        const reason = `Honeypot : interaction avec un ${inHoneypotChannel ? "salon piège" : "rôle piège"} sur ${guild.name}`
        if (config.honeypot.punishment === "lockdown") {
          await this.activateRaidMode(client, config, config.honeypot.duration)
          this.setCooldown(guild.id, member.id, RAID_COOLDOWN)
          this.addSuspect(guild.id, member.id, 50)
          this.logEvent(guild.id, "honeypot", `Honeypot : <@${member.id}>`)
          await sendLog(
            client,
            guild.id,
            buildAntiRaidEmbed(
              "pin",
              "Honeypot",
              `> ***Utilisateur:** <@${member.id}> (${member.user.tag})*\n> ***Détection:** message dans un ${inHoneypotChannel ? "salon piège" : "rôle piège"}*\n> ***Action:** Verrouillage du serveur*`,
              colors.red
            )
          )
          return
        }
        const result = await punishMember(client, member, config.honeypot.punishment, config.honeypot.duration, reason)
        this.setCooldown(guild.id, member.id, PUNISH_COOLDOWN)
        await sendLog(
          client,
          guild.id,
          buildAntiRaidEmbed(
            "pin",
            "Honeypot",
            `> ***Utilisateur:** <@${member.id}> (${member.user.tag})*\n> ***Détection:** message dans un ${inHoneypotChannel ? "salon piège" : "rôle piège"}*\n> ***Punition:** ${result.label}${result.note ? ` — ${result.note}` : ""}*`,
            colors.red
          )
        )
        this.logEvent(guild.id, "honeypot", `Honeypot : <@${member.id}>`)
        this.addSuspect(guild.id, member.id, 50)
        return
      }
    }

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

    const badword = config.modules.badword
    if (badword.enabled && badword.bannedWords.length > 0) {
      const normalized = message.content.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      const hit = badword.bannedWords.find((word) => {
        const clean = word.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        if (!clean) return false
        return new RegExp(`(^|[^a-z0-9])${escapeRegExp(clean)}([^a-z0-9]|$)`).test(normalized)
      })
      if (hit) {
        if (this.isCooldown(guild.id, member.id)) {
          try {
            await message.delete()
          } catch {}
          return
        }
        const reason = `Anti-Raid (Anti-Mot Interdit) : mot interdit "${hit}" sur ${guild.name}`
        const result = await punishMember(client, member, badword.punishment, badword.duration, reason)
        this.setCooldown(guild.id, member.id, PUNISH_COOLDOWN)
        this.addSuspect(guild.id, member.id, 25)
        this.logEvent(guild.id, "badword", `Anti-Mot Interdit : <@${member.id}> (${hit})`)
        await sendLog(
          client,
          guild.id,
          buildAntiRaidEmbed(
            "cancel",
            "Anti-Mot Interdit",
            `> ***Utilisateur:** <@${member.id}> (${member.user.tag})*\n> ***Mot interdit:** \`${hit}\`*\n> ***Punition:** ${result.label}${result.note ? ` — ${result.note}` : ""}*`,
            colors.red
          )
        )
        return
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
      this.addSuspect(guild.id, member.id, 30)
      this.logEvent(guild.id, "lockdown", `${moduleLabel} : verrouillage`)
      await sendLog(
        client,
        guild.id,
        buildAntiRaidEmbed(
          "cancel",
          moduleLabel,
          `> ***Déclenché par:** <@${member.id}> (${member.user.tag})*\n> ***Détection:** ${detection}*\n> ***Action:** Verrouillage du serveur*`,
          colors.red
        )
      )
      return
    }

    const result = await punishMember(client, member, settings.punishment, settings.duration, reason)
    this.setCooldown(guild.id, member.id, PUNISH_COOLDOWN)
    this.addSuspect(guild.id, member.id, 20)
    this.logEvent(guild.id, moduleLabel.toLowerCase(), `${moduleLabel} : <@${member.id}>`)
    await sendLog(
      client,
      guild.id,
      buildAntiRaidEmbed(
        "cancel",
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
    if (this.anyModuleEnabled(config) === false && !config.raidMode && !config.quarantine.enabled) return

    if (config.quarantine.enabled && config.quarantine.users.includes(member.id)) {
      const roleId = config.quarantine.role
      if (roleId) {
        const role = guild.roles.cache.get(roleId)
        if (role) {
          try {
            await member.roles.add(role, "Membre en quarantaine")
          } catch {}
        }
      }
    }

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
          "cancel",
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
        "cancel",
        "Raid détecté",
        `> ***${targets.length} membres sont arrivés en ${formatTime(settings.interval)}.***\n> ***Punition:** ${PUNISHMENT_LABELS[settings.punishment]}*\n> ***Membres sanctionnés:** ${count}/${targets.length}*`,
        colors.red
      )
    )
    for (const user of users) this.addSuspect(guild.id, user.id, 25)
    this.logEvent(guild.id, "joins", `Raid de ${targets.length} membres`)
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
        "people",
        "Anti-Bot",
        `> ***${targets.length} bots sont arrivés en ${formatTime(settings.interval)}.***\n> ***Bots bannis:** ${count}/${targets.length}*`,
        colors.red
      )
    )
    for (const user of users) this.addSuspect(guild.id, user.id, 25)
    this.logEvent(guild.id, "bots", `Raid de ${targets.length} bots`)
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

    const threshold =
      type === "channelDelete"
        ? settings.channelThreshold
        : type === "roleDelete"
          ? settings.roleThreshold
          : type === "ban"
            ? settings.channelThreshold
            : settings.webhookThreshold
    if (recent.length < threshold) return

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
    if (actorUser) this.addSuspect(guild.id, actorUser.id, 40)
    this.logEvent(guild.id, "nuke", `Anti-Nuke : ${recent.length} actions en ${formatTime(settings.interval)}`)
    await sendLog(
      client,
      guild.id,
      buildAntiRaidEmbed(
        "cancel",
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

  logEvent(guildId: string, type: string, detail?: string) {
    const list = this.eventLog.get(guildId) ?? []
    list.push({ guildId, type, detail, ts: Date.now() })
    this.eventLog.set(guildId, list.slice(-200))
  }

  getEventLog(guildId: string): EventEntry[] {
    return (this.eventLog.get(guildId) ?? []).filter((entry) => Date.now() - entry.ts <= 24 * 60 * 60 * 1000)
  }

  clearEventLog(guildId: string) {
    this.eventLog.delete(guildId)
  }

  private addSuspect(guildId: string, userId: string, points: number) {
    const list = this.suspects.get(guildId) ?? []
    list.push({ userId, score: points, ts: Date.now() })
    this.suspects.set(guildId, list.slice(-100))
  }

  getTopSuspects(guildId: string, limit = 5): SuspectEntry[] {
    const recent = (this.suspects.get(guildId) ?? []).filter((entry) => Date.now() - entry.ts <= 24 * 60 * 60 * 1000)
    const totals = new Map<string, number>()
    for (const entry of recent) {
      totals.set(entry.userId, (totals.get(entry.userId) ?? 0) + entry.score)
    }
    return [...totals.entries()]
      .map(([userId, score]) => ({ userId, score: Math.min(100, score), ts: Date.now() }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  getThreatLevel(guildId: string): number {
    const now = Date.now()
    let level = 0

    const joins = this.joins.recent(guildId, 60_000).length
    const bots = this.botJoins.recent(guildId, 60_000).length
    const destructive = this.destructive.recent(guildId, 60_000).length

    if (joins >= 10) level += 35
    else if (joins >= 5) level += 20
    else if (joins >= 3) level += 10

    if (bots >= 3) level += 25
    else if (bots >= 2) level += 15

    if (destructive >= 3) level += 30
    else if (destructive >= 2) level += 15

    for (const key of this.rates.keys()) {
      if (key.startsWith("mentions:") || key.startsWith("spam:")) {
        const count = this.rates.count(key, 60_000)
        if (count >= 10) level += 10
        break
      }
    }

    const config = this.configCache.get(guildId)?.config
    if (config?.raidMode && Date.now() < config.raidEndsAt) level = Math.max(level, 60)

    return Math.min(100, level)
  }

  snapshotChannel(channel: Channel) {
    if (!("guild" in channel) || !channel.guild) return
    const type = channel.type
    if (
      type !== ChannelType.GuildText &&
      type !== ChannelType.GuildVoice &&
      type !== ChannelType.GuildCategory &&
      type !== ChannelType.GuildAnnouncement &&
      type !== ChannelType.GuildForum &&
      type !== ChannelType.GuildMedia &&
      type !== ChannelType.GuildStageVoice
    ) {
      return
    }
    const guildId = channel.guild.id
    this.channelSnapshots.set(`${guildId}:${channel.id}`, {
      id: channel.id,
      name: "name" in channel ? channel.name : "unknown",
      type: channel.type,
      parentId: "parentId" in channel ? channel.parentId : null,
      topic: "topic" in channel && channel.topic ? channel.topic : null,
      nsfw: "nsfw" in channel ? channel.nsfw : false,
    })
  }

  snapshotRole(role: Role) {
    const guildId = role.guild.id
    this.roleSnapshots.set(`${guildId}:${role.id}`, {
      id: role.id,
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.bitfield.toString(),
      position: role.position,
    })
  }

  async restoreChannel(client: Client, guild: Guild, channelId: string): Promise<string | null> {
    const snapshot = this.channelSnapshots.get(`${guild.id}:${channelId}`)
    if (!snapshot) return null
    try {
      const options: { name: string; parent?: string; topic?: string; nsfw?: boolean } = {
        name: snapshot.name,
      }
      if (snapshot.parentId) options.parent = snapshot.parentId
      if (snapshot.topic) options.topic = snapshot.topic
      if (snapshot.nsfw) options.nsfw = true

      const createOptions: Parameters<Guild["channels"]["create"]>[0] = {
        name: options.name,
        type: snapshot.type as never,
        parent: options.parent,
        topic: options.topic,
        nsfw: options.nsfw,
      }
      const created = await guild.channels.create(createOptions)
      this.channelSnapshots.delete(`${guild.id}:${channelId}`)
      this.logEvent(guild.id, "other", `Salon ${snapshot.name} restauré`)
      return created.id
    } catch (error) {
      console.error(`Failed to restore channel ${channelId}:`, error)
      return null
    }
  }

  async restoreRole(client: Client, guild: Guild, roleId: string): Promise<string | null> {
    const snapshot = this.roleSnapshots.get(`${guild.id}:${roleId}`)
    if (!snapshot) return null
    try {
      const created = await guild.roles.create({
        name: snapshot.name,
        color: snapshot.color,
        hoist: snapshot.hoist,
        mentionable: snapshot.mentionable,
        permissions: BigInt(snapshot.permissions),
        reason: "Restauration anti-nuke",
      })
      this.roleSnapshots.delete(`${guild.id}:${roleId}`)
      this.logEvent(guild.id, "other", `Rôle ${snapshot.name} restauré`)
      return created.id
    } catch (error) {
      console.error(`Failed to restore role ${roleId}:`, error)
      return null
    }
  }

  async applyMode(client: Client, guildId: string, mode: AntiRaidMode) {
    const config = await this.getConfig(guildId)
    if (mode !== "custom") {
      const preset = MODE_PRESETS[mode as Exclude<AntiRaidMode, "custom">]
      const update: Record<string, unknown> = { mode }
      for (const name of Object.keys(preset) as ModuleName[]) {
        const values = preset[name] as Partial<ModuleSettings>
        const module = config.modules[name]
        for (const [key, value] of Object.entries(values)) {
          if (!module.custom) update[`modules.${name}.${key}`] = value
        }
      }
      await AntiRaid.findOneAndUpdate({ guildId }, { $set: update }, { upsert: true })
    } else {
      await AntiRaid.findOneAndUpdate({ guildId }, { $set: { mode: "custom" } }, { upsert: true })
    }
    this.invalidateConfig(guildId)
    this.logEvent(guildId, "other", `Mode défini : ${mode}`)
  }

  async quarantineUser(client: Client, guild: Guild, userId: string): Promise<boolean> {
    const config = await this.getConfig(guild.id)
    const member = await this.resolveMember(guild, userId)
    if (!member) return false

    let roleId = config.quarantine.role
    if (!roleId) {
      try {
        const role = await guild.roles.create({
          name: "Quarantaine",
          color: 0x2b2d31,
          reason: "Rôle de quarantaine anti-raid",
        })
        roleId = role.id
        await AntiRaid.findOneAndUpdate({ guildId: guild.id }, { $set: { "quarantine.role": roleId } }, { upsert: true })
        this.invalidateConfig(guild.id)
      } catch (error) {
        console.error(`Failed to create quarantine role in guild ${guild.id}:`, error)
        return false
      }
    }

    const role = guild.roles.cache.get(roleId)
    if (!role) return false

    try {
      const rolesToRemove = member.roles.cache.filter((r) => r.id !== guild.id && r.id !== roleId)
      await member.roles.remove(rolesToRemove, "Mise en quarantaine")
      await member.roles.add(role, "Mise en quarantaine")
    } catch (error) {
      console.error(`Failed to quarantine ${userId}:`, error)
      return false
    }

    await AntiRaid.findOneAndUpdate(
      { guildId: guild.id },
      { $set: { "quarantine.enabled": true }, $addToSet: { "quarantine.users": userId } },
      { upsert: true }
    )
    this.invalidateConfig(guild.id)
    this.logEvent(guild.id, "other", `Quarantaine : <@${userId}>`)
    return true
  }

  async unquarantineUser(client: Client, guild: Guild, userId: string) {
    const config = await this.getConfig(guild.id)
    const member = await this.resolveMember(guild, userId)
    if (member && config.quarantine.role) {
      const role = guild.roles.cache.get(config.quarantine.role)
      if (role) {
        try {
          await member.roles.remove(role, "Fin de quarantaine")
        } catch {}
      }
    }
    await AntiRaid.findOneAndUpdate(
      { guildId: guild.id },
      { $pull: { "quarantine.users": userId } },
      { upsert: true }
    )
    this.invalidateConfig(guild.id)
    this.logEvent(guild.id, "other", `Fin de quarantaine : <@${userId}>`)
  }

  async handleHoneypotMemberUpdate(client: Client, member: GuildMember) {
    const guild = member.guild
    const config = await this.getConfig(guild.id)
    if (!config.enabled || !config.honeypot.enabled) return
    const hasHoneypotRole = config.honeypot.roles.some((roleId) => member.roles.cache.has(roleId))
    if (!hasHoneypotRole) return
    if (this.isWhitelisted(config, member)) return

    const reason = `Honeypot : attribution d'un rôle piège sur ${guild.name}`
    if (config.honeypot.punishment === "lockdown") {
      await this.activateRaidMode(client, config, config.honeypot.duration)
      this.setCooldown(guild.id, member.id, RAID_COOLDOWN)
      this.addSuspect(guild.id, member.id, 50)
      this.logEvent(guild.id, "honeypot", `Rôle piège : <@${member.id}>`)
      await sendLog(
        client,
        guild.id,
        buildAntiRaidEmbed(
          "pin",
          "Honeypot",
          `> ***Utilisateur:** <@${member.id}> (${member.user.tag})*\n> ***Détection:** rôle piège attribué*\n> ***Action:** Verrouillage du serveur*`,
          colors.red
        )
      )
      return
    }
    const result = await punishMember(client, member, config.honeypot.punishment, config.honeypot.duration, reason)
    this.setCooldown(guild.id, member.id, PUNISH_COOLDOWN)
    await sendLog(
      client,
      guild.id,
      buildAntiRaidEmbed(
        "pin",
        "Honeypot",
        `> ***Utilisateur:** <@${member.id}> (${member.user.tag})*\n> ***Détection:** rôle piège attribué*\n> ***Punition:** ${result.label}${result.note ? ` — ${result.note}` : ""}*`,
        colors.red
      )
    )
    this.logEvent(guild.id, "honeypot", `Rôle piège : <@${member.id}>`)
    this.addSuspect(guild.id, member.id, 50)
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
        "power",
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
      buildAntiRaidEmbed("power", "Mode raid désactivé", "> *Le verrouillage du serveur a été levé.*", colors.yel)
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
      buildAntiRaidEmbed("power", "Mode raid désactivé", "> *Le verrouillage automatique a expiré, le serveur est de nouveau accessible.*", colors.yel)
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

  private cleanup() {
    const now = Date.now()
    this.messages.cleanup(now)
    this.joins.cleanup(now)
    this.botJoins.cleanup(now)
    this.destructive.cleanup(now)
    this.rates.cleanup(now)

    for (const [key, list] of this.eventLog) {
      const filtered = list.filter((entry) => now - entry.ts <= 24 * 60 * 60 * 1000)
      if (filtered.length === 0) this.eventLog.delete(key)
      else this.eventLog.set(key, filtered)
    }
    for (const [key, list] of this.suspects) {
      const filtered = list.filter((entry) => now - entry.ts <= 24 * 60 * 60 * 1000)
      if (filtered.length === 0) this.suspects.delete(key)
      else this.suspects.set(key, filtered)
    }

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
  }
}
