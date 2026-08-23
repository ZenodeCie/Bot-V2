import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import {
  extractReason,
  formatDate,
  logCommandUse,
  replyError,
  requireGuild,
  resolveChannelIdFromArg,
  resolveTarget,
} from "../../utils/moderation/helpers.js"
import { buildNavRow, handlePageNav, type PageRenderResult } from "../../utils/moderation/pagination.js"
import { appEmojiHeading, appEmojiText } from "../../utils/appEmojis.js"
import { buildBlacklistEmbed, sendBlacklistLog } from "../../utils/blacklist/logs.js"
import { punishMember } from "../../utils/antiraid/punish.js"
import { PUNISHMENT_LABELS } from "../../utils/antiraid/schema.js"
import parseTime from "../../utils/parseTime.js"
import formatTime from "../../utils/formatTime.js"
import {
  BLACKLIST_PUNISHMENTS,
  BlacklistConfig,
  addEntry,
  countEntries,
  getConfig,
  getEntry,
  listEntries,
  removeEntry,
  type BlacklistPunishment,
} from "../../utils/blacklist/schema.js"

const PER_PAGE = 8

async function renderBlacklistPage(guildId: string, _target: string, page: number): Promise<PageRenderResult> {
  const total = await countEntries(guildId)
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const safe = Math.min(page, totalPages - 1)
  const entries = await listEntries(guildId, safe * PER_PAGE, PER_PAGE)

  const lines = entries.map(
    (e) =>
      `> **<@${e.userId}>** (\`${e.userId}\`)\n` +
      `> ***Raison :** ${e.reason}*\n` +
      `> *Par ${e.moderatorUsername} — ${formatDate(e.addedAt)}*`
  )

  const embed = {
    title: " ",
    description:
      `${appEmojiHeading("cancel", "Liste noire du serveur")}\n` +
      `> ***Total :** ${total} utilisateur(s)*\n\n` +
      (lines.join("\n\n") || "> *Aucun utilisateur sur liste noire.*") +
      `\n\n> ***Page :** ${safe + 1}/${totalPages}*`,
    color: 0xe82c20,
  }

  return { embeds: [embed], totalPages }
}

function isValidPunishment(value: string | undefined): value is BlacklistPunishment {
  return !!value && (BLACKLIST_PUNISHMENTS as readonly string[]).includes(value)
}

export default {
  name: "blacklist",
  description: "Gère la liste noire du serveur (bloque le bot + sanction automatique au join).",
  category: "blacklist",
  aliases: ["bl", "listenoire"],
  permissions: ["BanMembers"],
  usage: "<add|remove|check|list|config> ...",
  slash: [
    {
      name: "action",
      description: "Action",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        { name: "add", value: "add" },
        { name: "remove", value: "remove" },
        { name: "check", value: "check" },
        { name: "list", value: "list" },
        { name: "config", value: "config" },
      ],
    },
    { name: "utilisateur", description: "Utilisateur ciblé", type: ApplicationCommandOptionType.User, required: false },
    { name: "raison", description: "Raison (add) ou valeur (config)", type: ApplicationCommandOptionType.String, required: false },
    {
      name: "cle",
      description: "Réglage à modifier (config)",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "enabled", value: "enabled" },
        { name: "punishment", value: "punishment" },
        { name: "duration", value: "duration" },
        { name: "logchannel", value: "logchannel" },
      ],
    },
    { name: "page", description: "Page (list)", type: ApplicationCommandOptionType.Integer, required: false, minValue: 1 },
  ],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const action = i.options.getString("action", true)
    const user = i.options.getUser("utilisateur")
    const value = i.options.getString("raison")
    const key = i.options.getString("cle")
    const page = i.options.getInteger("page")

    if (action === "add" || action === "check" || action === "remove") {
      return [action, user?.id ?? "", ...(value ? [value] : [])]
    }
    if (action === "list") return [action, ...(page ? [String(page)] : [])]
    if (action === "config") return [action, ...(key ? [key] : []), ...(value ? [value] : [])]
    return [action]
  },

  async execute(client: Client, message: Message, args: string[]) {
    logCommandUse("blacklist", message)
    const guild = requireGuild(message)
    if (!guild) return

    const action = args[0]?.toLowerCase()
    const moderator = { id: message.author.id, username: message.author.username }

    // ---------------------------------------------------------------
    // add
    // ---------------------------------------------------------------
    if (action === "add") {
      const resolved = await resolveTarget(client, guild, args[1] ?? "", false)
      if (!resolved.ok) return replyError(message, "400 Bad Request", `> *${resolved.error}*`)
      const target = resolved.target

      if (target.id === message.author.id) {
        return replyError(message, "400 Bad Request", "> *Vous ne pouvez pas vous blacklister vous-même.*")
      }
      if (target.id === client.user?.id) {
        return replyError(message, "400 Bad Request", "> *Impossible de blacklister le bot.*")
      }
      if (target.id === guild.ownerId) {
        return replyError(message, "403 Forbidden", "> *Impossible de blacklister le propriétaire du serveur.*")
      }

      const existing = await getEntry(guild.id, target.id)
      if (existing) {
        return replyError(message, "409 Conflict", `> *<@${target.id}> est déjà sur la liste noire.*`)
      }

      const reason = extractReason(args, 2)
      await addEntry({
        guildId: guild.id,
        userId: target.id,
        username: target.username,
        globalName: target.globalName,
        reason,
        moderatorId: moderator.id,
        moderatorUsername: moderator.username,
      })

      let sanctionNote = ""
      if (target.member) {
        const config = await getConfig(guild.id)
        if (config.enabled && config.punishment !== "none") {
          const result = await punishMember(
            client,
            target.member,
            config.punishment,
            config.duration,
            `Ajout à la liste noire : ${reason}`
          )
          sanctionNote = result.applied
            ? `\n> ***Sanction immédiate :** ${PUNISHMENT_LABELS[config.punishment]}*`
            : `\n> *${appEmojiText("cancel")} Sanction immédiate impossible : ${result.note ?? "raison inconnue"}*`
        }
      }

      await sendBlacklistLog(
        client,
        guild.id,
        buildBlacklistEmbed(
          "cancel",
          "Utilisateur ajouté à la liste noire",
          `> ***Utilisateur :** <@${target.id}> (\`${target.id}\`)*\n` +
            `> ***Raison :** ${reason}*\n` +
            `> ***Modérateur :** ${moderator.username}*`
        )
      )

      return message.reply({
        embeds: [
          {
            title: " ",
            description:
              `${appEmojiHeading("cancel", "Utilisateur ajouté à la liste noire")}\n` +
              `> ***Utilisateur :** <@${target.id}> (\`${target.id}\`)*\n` +
              `> ***Raison :** ${reason}*` +
              sanctionNote,
            color: 0xe82c20,
          },
        ],
      })
    }

    // ---------------------------------------------------------------
    // remove
    // ---------------------------------------------------------------
    if (action === "remove") {
      const resolved = await resolveTarget(client, guild, args[1] ?? "", false)
      if (!resolved.ok) return replyError(message, "400 Bad Request", `> *${resolved.error}*`)
      const target = resolved.target

      const removed = await removeEntry(guild.id, target.id)
      if (!removed) {
        return replyError(message, "404 Not Found", `> *<@${target.id}> n'est pas sur la liste noire.*`)
      }

      await sendBlacklistLog(
        client,
        guild.id,
        buildBlacklistEmbed(
          "check",
          "Utilisateur retiré de la liste noire",
          `> ***Utilisateur :** <@${target.id}> (\`${target.id}\`)*\n> ***Modérateur :** ${moderator.username}*`
        )
      )

      return message.reply({
        embeds: [
          buildBlacklistEmbed(
            "check",
            "Utilisateur retiré de la liste noire",
            `> ***Utilisateur :** <@${target.id}> (\`${target.id}\`)*`
          ),
        ],
      })
    }

    // ---------------------------------------------------------------
    // check
    // ---------------------------------------------------------------
    if (action === "check") {
      const resolved = await resolveTarget(client, guild, args[1] ?? "", false)
      if (!resolved.ok) return replyError(message, "400 Bad Request", `> *${resolved.error}*`)
      const target = resolved.target

      const entry = await getEntry(guild.id, target.id)
      if (!entry) {
        return message.reply({
          embeds: [
            buildBlacklistEmbed(
              "check",
              "Vérification liste noire",
              `> ***Utilisateur :** <@${target.id}>*\n> *N'est pas sur la liste noire de ce serveur.*`,
              null
            ),
          ],
        })
      }

      return message.reply({
        embeds: [
          buildBlacklistEmbed(
            "cancel",
            "Vérification liste noire",
            `> ***Utilisateur :** <@${entry.userId}>*\n` +
              `> ***Raison :** ${entry.reason}*\n` +
              `> ***Ajouté par :** ${entry.moderatorUsername}*\n` +
              `> ***Date :** ${formatDate(entry.addedAt)}*`
          ),
        ],
      })
    }

    // ---------------------------------------------------------------
    // list
    // ---------------------------------------------------------------
    if (action === "list" || !action) {
      const page = Math.max(0, (Number(args[1]) || 1) - 1)
      const { embeds, totalPages } = await renderBlacklistPage(guild.id, guild.id, page)
      return message.reply({
        embeds,
        components: [buildNavRow("blacklist", guild.id, message.author.id, guild.id, page, totalPages)],
      })
    }

    // ---------------------------------------------------------------
    // config
    // ---------------------------------------------------------------
    if (action === "config") {
      const key = args[1]?.toLowerCase()
      const value = args[2]

      if (!key) {
        const config = await getConfig(guild.id)
        return message.reply({
          embeds: [
            buildBlacklistEmbed(
              "cog",
              "Configuration de la liste noire",
              `> ***Activée :** ${config.enabled ? "Oui" : "Non"}*\n` +
                `> ***Sanction au join :** ${PUNISHMENT_LABELS[config.punishment]}*\n` +
                `> ***Durée :** ${config.duration > 0 ? formatTime(config.duration) : "—"}*\n` +
                `> ***Salon de logs :** ${config.logChannel ? `<#${config.logChannel}>` : "Aucun"}*`,
              null
            ),
          ],
        })
      }

      if (key === "enabled") {
        const enabled = value?.toLowerCase() === "on" || value?.toLowerCase() === "true"
        await BlacklistConfig.findOneAndUpdate({ guildId: guild.id }, { enabled }, { upsert: true })
        return message.reply({
          embeds: [buildBlacklistEmbed("check", "Configuration mise à jour", `> ***Activée :** ${enabled ? "Oui" : "Non"}*`)],
        })
      }

      if (key === "punishment") {
        if (!isValidPunishment(value)) {
          return replyError(
            message,
            "400 Bad Request",
            `> *Valeur invalide. Options : \`${BLACKLIST_PUNISHMENTS.join("`, `")}\`.*`
          )
        }
        await BlacklistConfig.findOneAndUpdate({ guildId: guild.id }, { punishment: value }, { upsert: true })
        return message.reply({
          embeds: [
            buildBlacklistEmbed("check", "Configuration mise à jour", `> ***Sanction au join :** ${PUNISHMENT_LABELS[value]}*`),
          ],
        })
      }

      if (key === "duration") {
        const ms = value ? parseTime(value) : 0
        if (ms === null) return replyError(message, "400 Bad Request", "> *Durée invalide. Exemple : `10m`, `1h`.*")
        await BlacklistConfig.findOneAndUpdate({ guildId: guild.id }, { duration: ms }, { upsert: true })
        return message.reply({
          embeds: [
            buildBlacklistEmbed(
              "check",
              "Configuration mise à jour",
              `> ***Durée (timeout) :** ${ms > 0 ? formatTime(ms) : "—"}*`
            ),
          ],
        })
      }

      if (key === "logchannel") {
        const channelId = value === "none" ? null : resolveChannelIdFromArg(value ?? "")
        if (value !== "none" && !channelId) {
          return replyError(message, "400 Bad Request", "> *Salon invalide. Mentionnez un salon ou `none` pour désactiver.*")
        }
        await BlacklistConfig.findOneAndUpdate({ guildId: guild.id }, { logChannel: channelId }, { upsert: true })
        return message.reply({
          embeds: [
            buildBlacklistEmbed(
              "check",
              "Configuration mise à jour",
              `> ***Salon de logs :** ${channelId ? `<#${channelId}>` : "Aucun"}*`
            ),
          ],
        })
      }

      return replyError(message, "400 Bad Request", "> *Clé invalide. Options : `enabled`, `punishment`, `duration`, `logchannel`.*")
    }

    return replyError(
      message,
      "400 Bad Request",
      "> *Utilisation : `blacklist <add|remove|check|list|config> ...`*"
    )
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handlePageNav(interaction, "blacklist", renderBlacklistPage)
  },
}
