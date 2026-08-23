import type { Client, Guild, GuildTextBasedChannel, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import formatTime from "../../utils/formatTime.js"
import { resolveChannelIdFromArg } from "../../utils/moderation/helpers.js"
import parseTime from "../../utils/parseTime.js"
import {
  COMPONENTS_V2_FLAGS,
  buildMessageHoraireContainer,
  buildMessageHoraireEmbed,
  handleMessageHoraireInteraction,
} from "../../utils/message-horaire/dashboard.js"
import { createJob, removeJob, setJobEnabled } from "../../utils/message-horaire/engine.js"
import {
  clampInterval,
  defaultConfig,
  getConfig,
  getJob,
  isJobId,
  listJobs,
  updateConfig,
} from "../../utils/message-horaire/schema.js"

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
}

function normalizeHead(raw: string | undefined): string | null {
  if (!raw) return null
  const value = stripAccents(raw.toLowerCase())
  if (["create", "add", "ajouter", "new"].includes(value)) return "create"
  if (["list", "liste", "ls"].includes(value)) return "list"
  if (["delete", "remove", "del", "rm", "supprimer"].includes(value)) return "delete"
  if (["on", "enable", "enabled", "true", "oui", "1"].includes(value)) return "on"
  if (["off", "disable", "disabled", "false", "non", "0"].includes(value)) return "off"
  if (["salon", "channel"].includes(value)) return "salon"
  if (["reset", "clear"].includes(value)) return "reset"
  if (["panel", "status", "config"].includes(value)) return "panel"
  return value
}

function isOffArg(raw: string | undefined): boolean {
  if (!raw) return false
  return ["off", "disable", "none", "aucun"].includes(stripAccents(raw.toLowerCase()))
}

async function sendPanel(client: Client, message: Message, guild: Guild) {
  const [config, jobs] = await Promise.all([getConfig(guild.id), listJobs(guild.id)])
  return message.reply({
    components: buildMessageHoraireContainer(client, guild, config, jobs),
    flags: COMPONENTS_V2_FLAGS,
  })
}

async function resolveTextChannel(guild: Guild, channelId: string | null): Promise<GuildTextBasedChannel | null> {
  if (!channelId) return null
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null))
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return null
  return channel
}

async function resolveJobForGuild(guildId: string, raw: string | undefined) {
  if (!raw || !isJobId(raw.trim())) return null
  const job = await getJob(raw.trim())
  if (!job || job.guildId !== guildId) return null
  return job
}

export default {
  name: "message-horaire",
  description: "Programmez des messages ou embeds envoyés régulièrement.",
  category: "message-horaire",
  slashRegister: false,
  aliases: ["messagehoraire", "horaire", "schedule"],
  permissions: ["ManageGuild"],
  usage: "[create|list|delete|on|off|salon|reset]",
  slash: [
    {
      name: "action",
      description: "create, list, delete, on, off, salon, reset",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "panel", value: "panel" },
        { name: "create", value: "create" },
        { name: "list", value: "list" },
        { name: "delete", value: "delete" },
        { name: "on", value: "on" },
        { name: "off", value: "off" },
        { name: "salon", value: "salon" },
        { name: "reset", value: "reset" },
      ],
    },
    { name: "duree", description: "Intervalle (5m, 1h, 1d…)", type: ApplicationCommandOptionType.String, required: false },
    { name: "salon", description: "Salon d'envoi", type: ApplicationCommandOptionType.Channel, required: false },
    { name: "message", description: "Contenu du message", type: ApplicationCommandOptionType.String, required: false },
    { name: "id", description: "Identifiant du message horaire", type: ApplicationCommandOptionType.String, required: false },
  ],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const action = i.options.getString("action")
    if (!action) return []
    const args = [action]
    if (action === "create") {
      const duree = i.options.getString("duree")
      if (duree) args.push(duree)
      const salon = i.options.getChannel("salon")
      if (salon) args.push(`<#${salon.id}>`)
      const message = i.options.getString("message")
      if (message) args.push(message)
      return args
    }
    if (action === "delete" || action === "on" || action === "off") {
      const id = i.options.getString("id")
      if (id) args.push(id)
      return args
    }
    if (action === "salon") {
      const salon = i.options.getChannel("salon")
      if (salon) args.push(`<#${salon.id}>`)
      return args
    }
    return args
  },

  async execute(client: Client, message: Message, args: string[]) {
    console.log(
      `Command message-horaire used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
    )

    if (!message.guild) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }

    const guild = message.guild
    const head = normalizeHead(args[0])

    if (!head || head === "panel") {
      return sendPanel(client, message, guild)
    }

    if (head === "reset") {
      const defaults = defaultConfig(guild.id)
      await updateConfig(guild.id, { $set: { defaultChannelId: defaults.defaultChannelId } })
      return message.reply({
        embeds: [
          buildMessageHoraireEmbed(
            "check",
            "Messages horaires réinitialisés",
            "> *Le salon par défaut a été remis aux valeurs d'origine.*"
          ),
        ],
      })
    }

    if (head === "salon") {
      const raw = args[1] ?? ""
      if (isOffArg(raw)) {
        await updateConfig(guild.id, { $set: { defaultChannelId: null } })
        return message.reply({
          embeds: [
            buildMessageHoraireEmbed("file", "Salon retiré", "> *Aucun salon par défaut n'est configuré.*", colors.prime),
          ],
        })
      }
      const channelId = message.mentions.channels.first()?.id ?? resolveChannelIdFromArg(raw)
      const channel = await resolveTextChannel(guild, channelId)
      if (!channel) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Salon invalide. Utilisez : `message-horaire salon <#salon|off>`.*")],
        })
      }
      await updateConfig(guild.id, { $set: { defaultChannelId: channel.id } })
      return message.reply({
        embeds: [buildMessageHoraireEmbed("file", "Salon configuré", `> ***Salon par défaut :** <#${channel.id}>*`)],
      })
    }

    if (head === "list") {
      const jobs = await listJobs(guild.id)
      if (jobs.length === 0) {
        return message.reply({
          embeds: [buildMessageHoraireEmbed("loop", "Messages horaires", "> *Aucun message programmé.*", colors.prime)],
        })
      }
      const lines = jobs.map((job) => {
        return (
          `> \`${job.id}\` — ${job.enabled ? "**on**" : "**off**"} — <#${job.channelId}> — \`${formatTime(job.interval)}\` — ` +
          `<t:${Math.floor(job.nextAt / 1000)}:R>`
        )
      })
      return message.reply({
        embeds: [
          buildMessageHoraireEmbed("loop", `Messages horaires (${jobs.length})`, lines.join("\n"), colors.prime),
        ],
      })
    }

    if (head === "create") {
      const rest = args.slice(1)
      if (!rest[0]) {
        return message.reply({
          embeds: [
            buildErrorEmbed(
              "400 Bad Request",
              "> *Utilisation : `message-horaire create <durée> [#salon] <message>`.*"
            ),
          ],
        })
      }
      const duration = parseTime(rest[0])
      if (duration === null || duration <= 0) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Durée invalide. Exemples : `5m`, `1h`, `1d`.*")],
        })
      }
      let index = 1
      let channelId: string | undefined
      const maybeChannelId = rest[1] ? resolveChannelIdFromArg(rest[1]) : null
      if (maybeChannelId) {
        const channel = await resolveTextChannel(guild, maybeChannelId)
        if (channel) {
          channelId = channel.id
          index++
        }
      }
      const content = rest.slice(index).join(" ").trim()
      if (!content) {
        return message.reply({
          embeds: [
            buildErrorEmbed(
              "400 Bad Request",
              "> *Indiquez un message. Utilisation : `message-horaire create <durée> [#salon] <message>`.*"
            ),
          ],
        })
      }
      const config = await getConfig(guild.id)
      const resolvedId = channelId ?? config.defaultChannelId ?? message.channel?.id ?? message.channelId
      const channel = await resolveTextChannel(guild, resolvedId)
      if (!channel) {
        return message.reply({
          embeds: [
            buildErrorEmbed(
              "400 Bad Request",
              "> *Salon invalide. Configurez un salon par défaut ou précisez un salon textuel.*"
            ),
          ],
        })
      }
      const result = await createJob({
        client,
        guildId: guild.id,
        channel,
        interval: clampInterval(duration),
        content,
      })
      if (!result.ok) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", result.error)] })
      }
      return message.reply({
        embeds: [
          buildMessageHoraireEmbed(
            "check",
            "Message horaire créé",
            `> ***ID :** \`${result.job.id}\`*\n` +
              `> ***Salon :** <#${result.job.channelId}>*\n` +
              `> ***Intervalle :** \`${formatTime(result.job.interval)}\`*\n` +
              `> ***Prochain envoi :** <t:${Math.floor(result.job.nextAt / 1000)}:R>*`
          ),
        ],
      })
    }

    if (head === "delete") {
      const job = await resolveJobForGuild(guild.id, args[1])
      if (!job) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Message horaire introuvable. Précisez l'ID (`list`).*")],
        })
      }
      const result = await removeJob(job.id)
      if (!result.ok) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", result.error)] })
      }
      return message.reply({
        embeds: [buildMessageHoraireEmbed("check", "Message horaire supprimé", `> ***ID :** \`${job.id}\`*`)],
      })
    }

    if (head === "on" || head === "off") {
      const job = await resolveJobForGuild(guild.id, args[1])
      if (!job) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Message horaire introuvable. Précisez l'ID (`list`).*")],
        })
      }
      const result = await setJobEnabled(client, job.id, head === "on")
      if (!result.ok) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", result.error)] })
      }
      return message.reply({
        embeds: [
          buildMessageHoraireEmbed(
            "check",
            head === "on" ? "Message horaire activé" : "Message horaire désactivé",
            `> ***ID :** \`${result.job.id}\`*`
          ),
        ],
      })
    }

    return sendPanel(client, message, guild)
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleMessageHoraireInteraction(client, interaction)
  },
}
