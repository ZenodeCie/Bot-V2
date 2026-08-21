import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { resolveChannelIdFromArg, resolveIdFromArg } from "../../utils/moderation/helpers.js"
import {
  COMPONENTS_V2_FLAGS,
  buildRulesContainer,
  buildRulesEmbed,
  handleRulesInteraction,
} from "../../utils/rules/dashboard.js"
import { publishRules, republishIfPublished } from "../../utils/rules/engine.js"
import { clampTitle, defaultConfig, getConfig, updateConfig } from "../../utils/rules/schema.js"

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
}

function normalizeHead(raw: string | undefined): string | null {
  if (!raw) return null
  const value = stripAccents(raw.toLowerCase())
  if (["on", "enable", "enabled", "true", "oui", "1"].includes(value)) return "on"
  if (["off", "disable", "disabled", "false", "non", "0"].includes(value)) return "off"
  if (["salon", "channel"].includes(value)) return "salon"
  if (["role", "roles"].includes(value)) return "role"
  if (["bots", "bot", "ignorebots"].includes(value)) return "bots"
  if (["titre", "title"].includes(value)) return "titre"
  if (["publish", "publier", "actualiser", "refresh", "update"].includes(value)) return "publish"
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
  return message.reply({
    components: buildRulesContainer(client, guild, config),
    flags: COMPONENTS_V2_FLAGS,
  })
}

export default {
  name: "rules",
  description: "Configure le règlement interactif du serveur.",
  category: "rules",
  slashName: "config",
  aliases: ["reglement", "regles"],
  permissions: ["ManageGuild"],
  usage: "[on|off|salon|role|bots|titre|publish|reset]",
  slash: [
    {
      name: "action",
      description: "on, off, salon, role, bots, titre, publish, reset",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "panel", value: "panel" },
        { name: "on", value: "on" },
        { name: "off", value: "off" },
        { name: "salon", value: "salon" },
        { name: "role", value: "role" },
        { name: "bots", value: "bots" },
        { name: "titre", value: "titre" },
        { name: "publish", value: "publish" },
        { name: "reset", value: "reset" },
      ],
    },
    { name: "valeur", description: "on, off, titre…", type: ApplicationCommandOptionType.String, required: false },
    { name: "salon", description: "Salon du règlement", type: ApplicationCommandOptionType.Channel, required: false },
    { name: "role", description: "Rôle après validation", type: ApplicationCommandOptionType.Role, required: false },
  ],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const action = i.options.getString("action")
    if (!action) return []
    const args = [action]
    const valeur = i.options.getString("valeur")
    if (valeur) args.push(valeur)
    const salon = i.options.getChannel("salon")
    if (salon) args.push(`<#${salon.id}>`)
    const role = i.options.getRole("role")
    if (role) args.push(role.id)
    return args
  },

  async execute(client: Client, message: Message, args: string[]) {
    console.log(
      `Command rules used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
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
      await republishIfPublished(client, guild.id)
      const config = await getConfig(guild.id)
      const missing: string[] = []
      if (enabled && !config.channelId) missing.push("salon")
      return message.reply({
        embeds: [
          buildRulesEmbed(
            "check",
            enabled ? "Règlement activé" : "Règlement désactivé",
            enabled
              ? `> *Le règlement est maintenant **activé**.*` +
                  (missing.length > 0
                    ? `\n> *Configurez encore un **salon**.*`
                    : `\n> ***Salon :** <#${config.channelId}>*`)
              : "> *Le règlement est maintenant **désactivé**.*"
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
          roleId: defaults.roleId,
          ignoreBots: defaults.ignoreBots,
        },
      })
      return message.reply({
        embeds: [buildRulesEmbed("check", "Règlement réinitialisé", "> *Tous les paramètres ont été remis aux valeurs par défaut.*")],
      })
    }

    if (head === "salon") {
      const raw = args[1] ?? ""
      if (isOffArg(raw)) {
        await updateConfig(guild.id, { $set: { channelId: null, messageId: null } })
        return message.reply({
          embeds: [buildRulesEmbed("file", "Salon retiré", "> *Aucun salon n'est configuré.*", colors.prime)],
        })
      }
      const channelId = message.mentions.channels.first()?.id ?? resolveChannelIdFromArg(raw)
      const channel = channelId
        ? (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)))
        : null
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Salon invalide. Utilisez : `rules salon <#salon|off>`.*")],
        })
      }
      await updateConfig(guild.id, { $set: { channelId: channel.id, messageId: null } })
      await republishIfPublished(client, guild.id)
      return message.reply({
        embeds: [buildRulesEmbed("file", "Salon configuré", `> ***Salon :** <#${channel.id}>*`)],
      })
    }

    if (head === "role") {
      const raw = args[1] ?? ""
      if (isOffArg(raw)) {
        await updateConfig(guild.id, { $set: { roleId: null } })
        await republishIfPublished(client, guild.id)
        return message.reply({
          embeds: [buildRulesEmbed("file", "Rôle retiré", "> *Aucun rôle n'est configuré.*", colors.prime)],
        })
      }
      const id = message.mentions.roles.first()?.id ?? resolveIdFromArg(raw)
      if (!id) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `rules role <@rôle|id|off>`.*")],
        })
      }
      if (id === guild.id) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Le rôle @everyone ne peut pas être utilisé.*")],
        })
      }
      const role = guild.roles.cache.get(id) ?? (await guild.roles.fetch(id).catch(() => null))
      if (!role) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Rôle introuvable.*")] })
      }
      await updateConfig(guild.id, { $set: { roleId: role.id } })
      await republishIfPublished(client, guild.id)
      return message.reply({
        embeds: [buildRulesEmbed("file", "Rôle configuré", `> ***Rôle :** ${role}*`)]
      })
    }

    if (head === "bots") {
      const next = parseBool(args[1])
      if (next === null && args[1]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `rules bots <on|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.ignoreBots
      await updateConfig(guild.id, { $set: { ignoreBots: enabled } })
      return message.reply({
        embeds: [
          buildRulesEmbed(
            "check",
            "Bots",
            enabled
              ? "> *Les bots **ne peuvent plus** valider le règlement.*"
              : "> *Les bots **peuvent** valider le règlement.*"
          ),
        ],
      })
    }

    if (head === "titre") {
      const title = clampTitle(args.slice(1).join(" "))
      await updateConfig(guild.id, { $set: { title } })
      await republishIfPublished(client, guild.id)
      return message.reply({
        embeds: [
          buildRulesEmbed(
            "check",
            "Titre mis à jour",
            title ? `> ***Titre :** ${title}*` : "> *Le titre utilisera **Règlement**.*"
          ),
        ],
      })
    }

    if (head === "publish") {
      const result = await publishRules(client, guild.id)
      if (!result.ok) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", result.error)] })
      }
      return message.reply({
        embeds: [
          buildRulesEmbed(
            "check",
            "Règlement publié",
            `> ***Salon :** <#${result.config.channelId}>*\n> *Le message a été envoyé ou mis à jour.*`
          ),
        ],
      })
    }

    return sendPanel(client, message, guild)
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleRulesInteraction(client, interaction)
  },
}
