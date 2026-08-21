import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { resolveChannelIdFromArg } from "../../utils/moderation/helpers.js"
import {
  COMPONENTS_V2_FLAGS,
  buildGuildLogsContainer,
  buildLogsEmbed,
  handleGuildLogsInteraction,
} from "../../utils/logs/dashboard.js"
import {
  EVENT_KEYS,
  EVENT_LABELS,
  defaultConfig,
  getConfig,
  parseEventKey,
  updateConfig,
  type EventKey,
} from "../../utils/logs/schema.js"

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
}

function normalizeHead(raw: string | undefined): string | null {
  if (!raw) return null
  const value = stripAccents(raw.toLowerCase())
  if (["on", "enable", "enabled", "true", "oui", "1"].includes(value)) return "on"
  if (["off", "disable", "disabled", "false", "non", "0"].includes(value)) return "off"
  if (["salon", "channel"].includes(value)) return "salon"
  if (["events", "event", "categories", "categorie"].includes(value)) return "events"
  if (["bots", "bot", "ignorebots"].includes(value)) return "bots"
  if (["ignore", "ignorer", "ignored"].includes(value)) return "ignore"
  if (["reset", "clear"].includes(value)) return "reset"
  if (["panel", "status", "config"].includes(value)) return "panel"
  return value
}

function parseBool(raw: string | undefined): boolean | null {
  if (!raw) return null
  const value = stripAccents(raw.toLowerCase())
  if (["on", "enable", "enabled", "true", "oui", "1"].includes(value)) return true
  if (["off", "disable", "disabled", "false", "non", "0"].includes(value)) return false
  return null
}

function isOffArg(raw: string | undefined): boolean {
  if (!raw) return false
  return ["off", "disable", "none", "aucun"].includes(stripAccents(raw.toLowerCase()))
}

async function sendPanel(client: Client, message: Message, guild: Guild) {
  const config = await getConfig(guild.id)
  return message.reply({ components: buildGuildLogsContainer(client, guild, config), flags: COMPONENTS_V2_FLAGS })
}

export default {
  name: "logs",
  description: "Configure le journal des événements du serveur.",
  category: "logs",
  slashName: "config",
  aliases: ["serverlogs", "slog"],
  permissions: ["ManageGuild"],
  usage: "[on|off|salon|events|bots|ignore|reset]",
  slash: [
    {
      name: "action",
      description: "on, off, salon, events, bots, ignore, reset",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "panel", value: "panel" },
        { name: "on", value: "on" },
        { name: "off", value: "off" },
        { name: "salon", value: "salon" },
        { name: "events", value: "events" },
        { name: "bots", value: "bots" },
        { name: "ignore", value: "ignore" },
        { name: "reset", value: "reset" },
      ],
    },
    { name: "valeur", description: "on, off, catégorie…", type: ApplicationCommandOptionType.String, required: false },
    { name: "salon", description: "Salon de logs", type: ApplicationCommandOptionType.Channel, required: false },
  ],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const action = i.options.getString("action")
    if (!action) return []
    const args = [action]
    const valeur = i.options.getString("valeur")
    if (valeur) args.push(valeur)
    const salon = i.options.getChannel("salon")
    if (salon) args.push(`<#${salon.id}>`)
    return args
  },

  async execute(client: Client, message: Message, args: string[]) {
    console.log(
      `Command logs used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
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

    if (head === "on" || head === "off") {
      const enabled = head === "on"
      await updateConfig(guild.id, { $set: { enabled } })
      const config = await getConfig(guild.id)
      return message.reply({
        embeds: [
          buildLogsEmbed(
            "check",
            enabled ? "Logs activés" : "Logs désactivés",
            enabled
              ? `> *Les événements du serveur seront envoyés dans le salon configuré.*` +
                  (!config.channelId ? `\n> *Configurez encore un **salon**.*` : `\n> ***Salon :** <#${config.channelId}>*`)
              : "> *Le journal des événements est maintenant **désactivé**.*"
          ),
        ],
      })
    }

    if (head === "reset") {
      const defaults = defaultConfig(guild.id)
      await updateConfig(guild.id, {
        $set: {
          enabled: defaults.enabled,
          channelId: defaults.channelId,
          ignoreBots: defaults.ignoreBots,
          ignoredChannels: defaults.ignoredChannels,
          events: defaults.events,
        },
      })
      return message.reply({
        embeds: [buildLogsEmbed("check", "Logs réinitialisés", "> *Tous les paramètres ont été remis aux valeurs par défaut.*")],
      })
    }

    if (head === "salon") {
      const raw = args[1] ?? ""
      if (isOffArg(raw)) {
        await updateConfig(guild.id, { $set: { channelId: null } })
        return message.reply({
          embeds: [buildLogsEmbed("file", "Salon retiré", "> *Aucun salon n'est configuré.*", colors.prime)],
        })
      }
      const channelId = message.mentions.channels.first()?.id ?? resolveChannelIdFromArg(raw)
      const channel = channelId
        ? (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)))
        : null
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Salon invalide. Utilisez : `logs salon <#salon|off>`.*")],
        })
      }
      await updateConfig(guild.id, { $set: { channelId: channel.id } })
      return message.reply({
        embeds: [buildLogsEmbed("file", "Salon configuré", `> ***Salon :** <#${channel.id}>*`)],
      })
    }

    if (head === "events") {
      const key = parseEventKey(args[1])
      if (!key) {
        const list = EVENT_KEYS.map((item) => `\`${item}\``).join(", ")
        return message.reply({
          embeds: [
            buildErrorEmbed(
              "400 Bad Request",
              `> *Utilisation : \`logs events <catégorie|all> [on|off]\`.*\n> *Catégories : ${list}.*`
            ),
          ],
        })
      }
      const next = parseBool(args[2])
      if (key === "all") {
        const enabled = next ?? true
        const events = Object.fromEntries(EVENT_KEYS.map((item) => [item, enabled]))
        await updateConfig(guild.id, { $set: { events } })
        return message.reply({
          embeds: [
            buildLogsEmbed(
              "check",
              "Catégories",
              enabled ? "> *Toutes les catégories sont **activées**.*" : "> *Toutes les catégories sont **désactivées**.*"
            ),
          ],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.events[key]
      await updateConfig(guild.id, { $set: { [`events.${key}`]: enabled } })
      return message.reply({
        embeds: [
          buildLogsEmbed(
            "check",
            EVENT_LABELS[key as EventKey],
            enabled ? `> *La catégorie **${EVENT_LABELS[key]}** est **activée**.*` : `> *La catégorie **${EVENT_LABELS[key]}** est **désactivée**.*`
          ),
        ],
      })
    }

    if (head === "bots") {
      const next = parseBool(args[1])
      if (next === null && args[1]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `logs bots <on|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.ignoreBots
      await updateConfig(guild.id, { $set: { ignoreBots: enabled } })
      return message.reply({
        embeds: [
          buildLogsEmbed(
            "check",
            "Bots",
            enabled
              ? "> *Les actions des bots **ne sont plus** journalisées.*"
              : "> *Les actions des bots **sont** journalisées.*"
          ),
        ],
      })
    }

    if (head === "ignore") {
      const raw = args[1] ?? ""
      if (isOffArg(raw) || stripAccents(raw.toLowerCase()) === "clear") {
        await updateConfig(guild.id, { $set: { ignoredChannels: [] } })
        return message.reply({
          embeds: [buildLogsEmbed("file", "Salons ignorés", "> *Aucun salon n'est ignoré.*", colors.prime)],
        })
      }
      const channelId = message.mentions.channels.first()?.id ?? resolveChannelIdFromArg(raw)
      const channel = channelId
        ? (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)))
        : null
      if (!channel || channel.isDMBased()) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `logs ignore <#salon|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const ignored = new Set(config.ignoredChannels)
      if (ignored.has(channel.id)) ignored.delete(channel.id)
      else ignored.add(channel.id)
      const ignoredChannels = [...ignored].slice(0, 25)
      await updateConfig(guild.id, { $set: { ignoredChannels } })
      return message.reply({
        embeds: [
          buildLogsEmbed(
            "file",
            "Salons ignorés",
            ignoredChannels.length
              ? `> ***Salons :** ${ignoredChannels.map((id) => `<#${id}>`).join(" ")}*`
              : "> *Aucun salon n'est ignoré.*"
          ),
        ],
      })
    }

    return sendPanel(client, message, guild)
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleGuildLogsInteraction(client, interaction)
  },
}
