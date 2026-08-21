import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import formatTime from "../../utils/formatTime.js"
import { resolveChannelIdFromArg } from "../../utils/moderation/helpers.js"
import parseTime from "../../utils/parseTime.js"
import {
  COMPONENTS_V2_FLAGS,
  buildInformationPanelContainer,
  buildInformationPanelEmbed,
  handleInformationPanelInteraction,
} from "../../utils/informationpanel/dashboard.js"
import { publishPanel, rescheduleInformationPanel } from "../../utils/informationpanel/engine.js"
import {
  clampInterval,
  clampTitle,
  defaultConfig,
  getConfig,
  updateConfig,
} from "../../utils/informationpanel/schema.js"

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
}

function normalizeHead(raw: string | undefined): string | null {
  if (!raw) return null
  const value = stripAccents(raw.toLowerCase())
  if (["on", "enable", "enabled", "true", "oui", "1"].includes(value)) return "on"
  if (["off", "disable", "disabled", "false", "non", "0"].includes(value)) return "off"
  if (["salon", "channel"].includes(value)) return "salon"
  if (["interval", "intervalle", "duree", "duration"].includes(value)) return "interval"
  if (["titre", "title"].includes(value)) return "titre"
  if (["publish", "publier", "actualiser", "refresh", "update"].includes(value)) return "publish"
  if (["reset", "clear"].includes(value)) return "reset"
  if (["panel", "status", "config"].includes(value)) return "panel"
  return value
}

function isOffArg(raw: string | undefined): boolean {
  if (!raw) return false
  return ["off", "disable", "none", "aucun"].includes(stripAccents(raw.toLowerCase()))
}

async function sendPanel(client: Client, message: Message, guild: Guild) {
  const config = await getConfig(guild.id)
  return message.reply({
    components: buildInformationPanelContainer(client, guild, config),
    flags: COMPONENTS_V2_FLAGS,
  })
}

export default {
  name: "infopanel",
  description: "Configure le panneau d'informations du serveur.",
  category: "informationpanel",
  aliases: ["information", "panneau", "infoserveur"],
  permissions: ["ManageGuild"],
  usage: "[on|off|salon|interval|titre|publish|reset]",
  slash: [
    {
      name: "action",
      description: "on, off, salon, interval, titre, publish, reset",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "panel", value: "panel" },
        { name: "on", value: "on" },
        { name: "off", value: "off" },
        { name: "salon", value: "salon" },
        { name: "interval", value: "interval" },
        { name: "titre", value: "titre" },
        { name: "publish", value: "publish" },
        { name: "reset", value: "reset" },
      ],
    },
    { name: "valeur", description: "on, off, durée, titre…", type: ApplicationCommandOptionType.String, required: false },
    { name: "salon", description: "Salon du panneau", type: ApplicationCommandOptionType.Channel, required: false },
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
      `Command infopanel used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
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
      const current = await getConfig(guild.id)
      const nextAt = enabled && current.channelId ? Date.now() : null
      await updateConfig(guild.id, { $set: { enabled, nextAt } })
      await rescheduleInformationPanel(client, guild.id)
      const config = await getConfig(guild.id)
      return message.reply({
        embeds: [
          buildInformationPanelEmbed(
            "check",
            enabled ? "Panneau activé" : "Panneau désactivé",
            enabled
              ? `> *Le panneau d'information est maintenant **activé**.*` +
                  (!config.channelId
                    ? `\n> *Configurez encore un **salon**.*`
                    : `\n> ***Salon :** <#${config.channelId}>*`)
              : "> *Le panneau d'information est maintenant **désactivé**.*"
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
          messageId: defaults.messageId,
          title: defaults.title,
          description: defaults.description,
          interval: defaults.interval,
          nextAt: defaults.nextAt,
          fields: defaults.fields,
        },
      })
      await rescheduleInformationPanel(client, guild.id)
      return message.reply({
        embeds: [
          buildInformationPanelEmbed(
            "check",
            "Panneau réinitialisé",
            "> *Tous les paramètres ont été remis aux valeurs par défaut.*"
          ),
        ],
      })
    }

    if (head === "salon") {
      const raw = args[1] ?? ""
      if (isOffArg(raw)) {
        await updateConfig(guild.id, { $set: { channelId: null, messageId: null, nextAt: null } })
        await rescheduleInformationPanel(client, guild.id)
        return message.reply({
          embeds: [buildInformationPanelEmbed("file", "Salon retiré", "> *Aucun salon n'est configuré.*", colors.prime)],
        })
      }
      const channelId = message.mentions.channels.first()?.id ?? resolveChannelIdFromArg(raw)
      const channel = channelId
        ? (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)))
        : null
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Salon invalide. Utilisez : `infopanel salon <#salon|off>`.*")],
        })
      }
      const current = await getConfig(guild.id)
      const nextAt = current.enabled ? Date.now() : current.nextAt
      await updateConfig(guild.id, { $set: { channelId: channel.id, messageId: null, nextAt } })
      await rescheduleInformationPanel(client, guild.id)
      return message.reply({
        embeds: [buildInformationPanelEmbed("file", "Salon configuré", `> ***Salon :** <#${channel.id}>*`)],
      })
    }

    if (head === "interval") {
      const parsed = parseTime(args[1] ?? "")
      if (parsed === null || parsed <= 0) {
        return message.reply({
          embeds: [
            buildErrorEmbed(
              "400 Bad Request",
              "> *Durée invalide. Utilisation : `infopanel interval <durée>` (ex. `5m`).*"
            ),
          ],
        })
      }
      const interval = clampInterval(parsed)
      const current = await getConfig(guild.id)
      const nextAt = current.enabled && current.channelId ? Date.now() + interval : current.nextAt
      await updateConfig(guild.id, { $set: { interval, nextAt } })
      await rescheduleInformationPanel(client, guild.id)
      return message.reply({
        embeds: [buildInformationPanelEmbed("check", "Intervalle mis à jour", `> ***Intervalle :** \`${formatTime(interval)}\`*`)],
      })
    }

    if (head === "titre") {
      const title = clampTitle(args.slice(1).join(" "))
      await updateConfig(guild.id, { $set: { title } })
      return message.reply({
        embeds: [
          buildInformationPanelEmbed(
            "check",
            "Titre mis à jour",
            title ? `> ***Titre :** ${title}*` : "> *Le titre utilisera le **nom du serveur**.*"
          ),
        ],
      })
    }

    if (head === "publish") {
      const result = await publishPanel(client, guild.id)
      if (!result.ok) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", result.error)] })
      }
      return message.reply({
        embeds: [
          buildInformationPanelEmbed(
            "check",
            "Panneau publié",
            `> ***Salon :** <#${result.config.channelId}>*\n> *Le message a été envoyé ou mis à jour.*`
          ),
        ],
      })
    }

    return sendPanel(client, message, guild)
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleInformationPanelInteraction(client, interaction)
  },
}
