import type { Client, Guild, GuildTextBasedChannel, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import formatTime from "../../utils/formatTime.js"
import {
  COMPONENTS_V2_FLAGS,
  buildGiveawayContainer,
  handleGiveawayInteraction,
  noticePayload,
} from "../../utils/giveaway/dashboard.js"
import { cancelGiveaway, endGiveaway, rerollGiveaway, startGiveaway } from "../../utils/giveaway/engine.js"
import {
  MAX_WINNERS,
  MIN_WINNERS,
  clampDuration,
  clampPrize,
  clampWinners,
  defaultConfig,
  getConfig,
  listActiveGiveaways,
  resolveGiveaway,
  updateConfig,
} from "../../utils/giveaway/schema.js"
import { resolveChannelIdFromArg, resolveIdFromArg } from "../../utils/moderation/helpers.js"
import parseTime from "../../utils/parseTime.js"

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
}

function normalizeHead(raw: string | undefined): string | null {
  if (!raw) return null
  const value = stripAccents(raw.toLowerCase())
  if (["start", "create", "commencer", "lancer"].includes(value)) return "start"
  if (["end", "stop", "terminer", "fin"].includes(value)) return "end"
  if (["reroll", "relancer", "rerol"].includes(value)) return "reroll"
  if (["cancel", "annuler", "delete"].includes(value)) return "cancel"
  if (["list", "liste", "ls"].includes(value)) return "list"
  if (["salon", "channel"].includes(value)) return "salon"
  if (["gagnants", "winners", "winner"].includes(value)) return "gagnants"
  if (["role", "roles"].includes(value)) return "role"
  if (["reset", "clear"].includes(value)) return "reset"
  if (["panel", "status", "config"].includes(value)) return "panel"
  return value
}

function isOffArg(raw: string | undefined): boolean {
  if (!raw) return false
  return ["off", "disable", "none", "aucun"].includes(stripAccents(raw.toLowerCase()))
}

async function sendPanel(client: Client, message: Message, guild: Guild) {
  const [config, active] = await Promise.all([getConfig(guild.id), listActiveGiveaways(guild.id)])
  return message.reply({
    components: buildGiveawayContainer(client, guild, config, active),
    flags: COMPONENTS_V2_FLAGS,
  })
}

async function resolveTextChannel(guild: Guild, channelId: string | null): Promise<GuildTextBasedChannel | null> {
  if (!channelId) return null
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null))
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return null
  return channel
}

interface ParsedStart {
  duration: number
  winnerCount?: number
  channelId?: string
  roleId?: string
  prize: string
}

async function parseStartArgs(guild: Guild, rest: string[]): Promise<ParsedStart | { error: string }> {
  if (!rest[0]) {
    return { error: "> *Utilisation : `giveaway start <durée> [gagnants] [#salon] [@rôle] <prix>`.*" }
  }
  const duration = parseTime(rest[0])
  if (duration === null || duration <= 0) {
    return { error: "> *Durée invalide. Exemples : `30s`, `5m`, `1h`, `1d`, `1w`.*" }
  }

  let index = 1
  let winnerCount: number | undefined
  let channelId: string | undefined
  let roleId: string | undefined

  while (index < rest.length) {
    const token = rest[index]
    if (!token) break

    if (winnerCount === undefined && /^\d+$/.test(token)) {
      const n = Number(token)
      if (n >= MIN_WINNERS && n <= MAX_WINNERS) {
        winnerCount = n
        index++
        continue
      }
    }

    const maybeChannelId = resolveChannelIdFromArg(token)
    if (maybeChannelId && !channelId) {
      const channel = await resolveTextChannel(guild, maybeChannelId)
      if (channel) {
        channelId = channel.id
        index++
        continue
      }
    }

    const roleMention = /^<@&(\d{17,20})>$/.exec(token)
    const maybeRoleId = roleMention?.[1] ?? resolveIdFromArg(token)
    if (maybeRoleId && !roleId && maybeRoleId !== guild.id) {
      const role = guild.roles.cache.get(maybeRoleId) ?? (await guild.roles.fetch(maybeRoleId).catch(() => null))
      if (role) {
        roleId = role.id
        index++
        continue
      }
    }

    break
  }

  const prize = clampPrize(rest.slice(index).join(" "))
  if (!prize) {
    return { error: "> *Indiquez un prix. Utilisation : `giveaway start <durée> [gagnants] [#salon] [@rôle] <prix>`.*" }
  }

  return { duration, winnerCount, channelId, roleId, prize }
}

export default {
  name: "giveaway",
  description: "Lance et gère les giveaways du serveur.",
  category: "giveaway",
  aliases: ["giveaways", "gw"],
  permissions: ["ManageGuild"],
  usage: "[start|end|reroll|cancel|list|salon|gagnants|role|reset]",
  slash: [
    {
      name: "action",
      description: "start, end, reroll, cancel, list, salon, gagnants, role, reset",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "panel", value: "panel" },
        { name: "start", value: "start" },
        { name: "end", value: "end" },
        { name: "reroll", value: "reroll" },
        { name: "cancel", value: "cancel" },
        { name: "list", value: "list" },
        { name: "salon", value: "salon" },
        { name: "gagnants", value: "gagnants" },
        { name: "role", value: "role" },
        { name: "reset", value: "reset" },
      ],
    },
    { name: "duree", description: "Durée (5m, 1h, 1d…)", type: ApplicationCommandOptionType.String, required: false },
    {
      name: "gagnants",
      description: "Nombre de gagnants",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: MIN_WINNERS,
      maxValue: MAX_WINNERS,
    },
    { name: "prix", description: "Prix du giveaway", type: ApplicationCommandOptionType.String, required: false },
    { name: "salon", description: "Salon du giveaway", type: ApplicationCommandOptionType.Channel, required: false },
    { name: "role", description: "Rôle requis pour participer", type: ApplicationCommandOptionType.Role, required: false },
    { name: "message", description: "ID ou lien du message du giveaway", type: ApplicationCommandOptionType.String, required: false },
  ],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const action = i.options.getString("action")
    if (!action) return []
    const args = [action]
    if (action === "start") {
      const duree = i.options.getString("duree")
      if (duree) args.push(duree)
      const gagnants = i.options.getInteger("gagnants")
      if (gagnants != null) args.push(String(gagnants))
      const salon = i.options.getChannel("salon")
      if (salon) args.push(`<#${salon.id}>`)
      const role = i.options.getRole("role")
      if (role) args.push(`<@&${role.id}>`)
      const prix = i.options.getString("prix")
      if (prix) args.push(prix)
      return args
    }
    if (action === "end" || action === "reroll" || action === "cancel") {
      const messageId = i.options.getString("message")
      if (messageId) args.push(messageId)
      return args
    }
    if (action === "salon") {
      const salon = i.options.getChannel("salon")
      if (salon) args.push(`<#${salon.id}>`)
      const prix = i.options.getString("prix")
      if (prix) args.push(prix)
      return args
    }
    if (action === "gagnants") {
      const gagnants = i.options.getInteger("gagnants")
      if (gagnants != null) args.push(String(gagnants))
      return args
    }
    if (action === "role") {
      const role = i.options.getRole("role")
      if (role) args.push(role.id)
      const prix = i.options.getString("prix")
      if (prix) args.push(prix)
      return args
    }
    return args
  },

  async execute(client: Client, message: Message, args: string[]) {
    console.log(
      `Command giveaway used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
    )

    if (!message.guild) {
      return message.reply(
        noticePayload("disable", "Contexte invalide", "> *Cette commande doit être exécutée dans un serveur.*")
      )
    }

    const guild = message.guild
    const head = normalizeHead(args[0])

    if (!head || head === "panel") {
      return sendPanel(client, message, guild)
    }

    if (head === "reset") {
      const defaults = defaultConfig(guild.id)
      await updateConfig(guild.id, {
        $set: {
          defaultChannelId: defaults.defaultChannelId,
          defaultWinnerCount: defaults.defaultWinnerCount,
          requiredRoleId: defaults.requiredRoleId,
        },
      })
      return message.reply(
        noticePayload("check", "Giveaway réinitialisé", "> *Les paramètres par défaut ont été remis aux valeurs d'origine.*")
      )
    }

    if (head === "salon") {
      const raw = args[1] ?? ""
      if (isOffArg(raw)) {
        await updateConfig(guild.id, { $set: { defaultChannelId: null } })
        return message.reply(noticePayload("disable", "Salon retiré", "> *Aucun salon par défaut n'est configuré.*"))
      }
      const channelId = message.mentions.channels.first()?.id ?? resolveChannelIdFromArg(raw)
      const channel = await resolveTextChannel(guild, channelId)
      if (!channel) {
        return message.reply(
          noticePayload("disable", "Salon invalide", "> *Salon invalide. Utilisez : `giveaway salon <#salon|off>`.*")
        )
      }
      await updateConfig(guild.id, { $set: { defaultChannelId: channel.id } })
      return message.reply(
        noticePayload("channel", "Salon configuré", `> ***Salon par défaut :** <#${channel.id}>*`)
      )
    }

    if (head === "role") {
      const raw = args[1] ?? ""
      if (isOffArg(raw)) {
        await updateConfig(guild.id, { $set: { requiredRoleId: null } })
        return message.reply(noticePayload("disable", "Rôle retiré", "> *Aucun rôle n'est requis pour participer.*"))
      }
      const id = message.mentions.roles.first()?.id ?? resolveIdFromArg(raw)
      if (!id) {
        return message.reply(noticePayload("disable", "Rôle invalide", "> *Utilisation : `giveaway role <@rôle|id|off>`.*"))
      }
      if (id === guild.id) {
        return message.reply(
          noticePayload("disable", "Rôle invalide", "> *Le rôle @everyone ne peut pas être utilisé.*")
        )
      }
      const role = guild.roles.cache.get(id) ?? (await guild.roles.fetch(id).catch(() => null))
      if (!role) {
        return message.reply(noticePayload("disable", "Rôle introuvable", "> *Rôle introuvable.*"))
      }
      await updateConfig(guild.id, { $set: { requiredRoleId: role.id } })
      return message.reply(noticePayload("cogUser", "Rôle configuré", `> ***Rôle requis :** ${role}*`))
    }

    if (head === "gagnants") {
      const raw = Number(args[1])
      if (!Number.isInteger(raw) || raw < MIN_WINNERS || raw > MAX_WINNERS) {
        return message.reply(
          noticePayload(
            "disable",
            "Valeur invalide",
            `> *Utilisation : \`giveaway gagnants <n>\` (${MIN_WINNERS}–${MAX_WINNERS}).*`
          )
        )
      }
      const defaultWinnerCount = clampWinners(raw)
      await updateConfig(guild.id, { $set: { defaultWinnerCount } })
      return message.reply(
        noticePayload("people", "Gagnants mis à jour", `> ***Gagnants par défaut :** \`${defaultWinnerCount}\`*`)
      )
    }

    if (head === "list") {
      const active = await listActiveGiveaways(guild.id, 25)
      if (active.length === 0) {
        return message.reply(noticePayload("notes", "Giveaways", "> *Aucun giveaway en cours.*"))
      }
      const lines = active.map((giveaway) => {
        const jump = giveaway.messageId
          ? `[message](https://discord.com/channels/${guild.id}/${giveaway.channelId}/${giveaway.messageId})`
          : "`en cours`"
        return (
          `> **${giveaway.prize}** — <#${giveaway.channelId}> — <t:${Math.floor(giveaway.endsAt / 1000)}:R> — ` +
          `\`${giveaway.participants.length}\` participant${giveaway.participants.length > 1 ? "s" : ""} — ${jump}`
        )
      })
      return message.reply(
        noticePayload("notes", `Giveaways en cours (${active.length})`, lines.join("\n"))
      )
    }

    if (head === "start") {
      const parsed = await parseStartArgs(guild, args.slice(1))
      if ("error" in parsed) {
        return message.reply(noticePayload("disable", "Utilisation incorrecte", parsed.error))
      }
      const config = await getConfig(guild.id)
      const channelId = parsed.channelId ?? config.defaultChannelId ?? message.channel?.id ?? message.channelId
      const channel = await resolveTextChannel(guild, channelId)
      if (!channel) {
        return message.reply(
          noticePayload(
            "disable",
            "Salon invalide",
            "> *Salon invalide. Configurez un salon par défaut ou précisez un salon textuel.*"
          )
        )
      }
      const result = await startGiveaway({
        client,
        guildId: guild.id,
        channel,
        hostId: message.author.id,
        prize: parsed.prize,
        duration: clampDuration(parsed.duration),
        winnerCount: clampWinners(parsed.winnerCount ?? config.defaultWinnerCount),
        requiredRoleId: parsed.roleId ?? config.requiredRoleId,
      })
      if (!result.ok) {
        return message.reply(noticePayload("disable", "Action impossible", result.error))
      }
      const remaining = result.giveaway.endsAt - Date.now()
      return message.reply(
        noticePayload(
          "party",
          "Giveaway lancé",
          `> ***Prix :** ${result.giveaway.prize}*\n` +
            `> ***Salon :** <#${result.giveaway.channelId}>*\n` +
            `> ***Gagnants :** \`${result.giveaway.winnerCount}\`*\n` +
            `> ***Durée :** \`${formatTime(remaining)}\`*\n` +
            `> ***Fin :** <t:${Math.floor(result.giveaway.endsAt / 1000)}:R>*`
        )
      )
    }

    if (head === "end" || head === "reroll" || head === "cancel") {
      const mode = head === "reroll" ? "ended" : "active"
      const target = await resolveGiveaway(guild.id, message.channel?.id ?? message.channelId, args[1], mode)
      if (!target) {
        return message.reply(
          noticePayload(
            "disable",
            "Giveaway introuvable",
            head === "reroll"
              ? "> *Aucun giveaway terminé à relancer. Précisez l'ID ou le lien du message.*"
              : "> *Aucun giveaway en cours. Précisez l'ID ou le lien du message.*"
          )
        )
      }
      const result =
        head === "end"
          ? await endGiveaway(client, target.id)
          : head === "reroll"
            ? await rerollGiveaway(client, target.id)
            : await cancelGiveaway(client, target.id)
      if (!result.ok) {
        return message.reply(noticePayload("disable", "Action impossible", result.error))
      }
      const title = head === "end" ? "Giveaway terminé" : head === "reroll" ? "Giveaway relancé" : "Giveaway annulé"
      const emojiKey = head === "end" ? ("check" as const) : head === "reroll" ? ("loop" as const) : ("disable" as const)
      const winners =
        result.giveaway.winners.length > 0
          ? result.giveaway.winners.map((id) => `<@${id}>`).join(", ")
          : "*Aucun*"
      return message.reply(
        noticePayload(
          emojiKey,
          title,
          `> ***Prix :** ${result.giveaway.prize}*\n` +
            (head === "cancel" ? "" : `> ***Gagnant${result.giveaway.winners.length > 1 ? "s" : ""} :** ${winners}*`)
        )
      )
    }

    return sendPanel(client, message, guild)
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleGiveawayInteraction(client, interaction)
  },
}
