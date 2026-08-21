import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { resolveChannelIdFromArg, resolveIdFromArg } from "../../utils/moderation/helpers.js"
import { COMPONENTS_V2_FLAGS, buildAeroportContainer, handleAeroportInteraction } from "../../utils/aeroport/dashboard.js"
import {
  buildAeroportEmbed,
  buildMessagePayload,
  contextFromMember,
} from "../../utils/aeroport/messages.js"
import {
  defaultConfig,
  getConfig,
  getTemplate,
  updateConfig,
  type AeroportView,
  type TemplateTarget,
} from "../../utils/aeroport/schema.js"

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
}

function normalizeHead(raw: string | undefined): string | null {
  if (!raw) return null
  const value = stripAccents(raw.toLowerCase())
  if (["arrivee", "arrival", "join", "bienvenue"].includes(value)) return "arrivee"
  if (["depart", "departure", "leave", "goodbye", "aurevoir"].includes(value)) return "depart"
  if (["dm", "mp", "prive", "private"].includes(value)) return "dm"
  if (["bots", "bot", "ignorebots"].includes(value)) return "bots"
  if (["autorole", "autoroles", "role", "roles"].includes(value)) return "autorole"
  if (["preview", "apercu"].includes(value)) return "preview"
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

function parseTargetArg(raw: string | undefined): TemplateTarget | null {
  const head = normalizeHead(raw)
  if (head === "arrivee") return "arrival"
  if (head === "depart") return "departure"
  if (head === "dm") return "dm"
  return null
}

function viewFromTarget(target: TemplateTarget): AeroportView {
  return target
}

function flightLabel(target: Exclude<TemplateTarget, "dm">): string {
  return target === "arrival" ? "Arrivée" : "Départ"
}

async function sendPanel(client: Client, message: Message, guild: Guild) {
  const config = await getConfig(guild.id)
  return message.reply({ components: buildAeroportContainer(client, guild, config, "home"), flags: COMPONENTS_V2_FLAGS })
}

export default {
  name: "aeroport",
  description: "Configure les messages d'arrivée et de départ, le MP et les autoroles.",
  category: "aeroport",
  aliases: ["airport", "welcome", "goodbye", "arrivee", "depart"],
  permissions: ["ManageGuild"],
  usage: "[arrivee|depart|dm|bots|autorole|preview|reset]",
  slash: [
    {
      name: "action",
      description: "arrivee, depart, dm, bots, autorole, preview, reset",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "panel", value: "panel" },
        { name: "arrivee", value: "arrivee" },
        { name: "depart", value: "depart" },
        { name: "dm", value: "dm" },
        { name: "bots", value: "bots" },
        { name: "autorole", value: "autorole" },
        { name: "preview", value: "preview" },
        { name: "reset", value: "reset" },
      ],
    },
    { name: "valeur", description: "on, off, salon, add, remove, arrivee…", type: ApplicationCommandOptionType.String, required: false },
    { name: "salon", description: "Salon d'arrivée ou de départ", type: ApplicationCommandOptionType.Channel, required: false },
    { name: "role", description: "Rôle d'autorole", type: ApplicationCommandOptionType.Role, required: false },
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
      `Command aeroport used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
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
      await updateConfig(guild.id, {
        $set: {
          ignoreBots: defaults.ignoreBots,
          arrival: defaults.arrival,
          departure: defaults.departure,
          dm: defaults.dm,
          autoroles: defaults.autoroles,
        },
      })
      return message.reply({
        embeds: [
          buildAeroportEmbed(
            "check",
            "Aéroport réinitialisé",
            "> *Arrivée, départ, message privé et autoroles ont été remis aux valeurs par défaut.*"
          ),
        ],
      })
    }

    if (head === "bots") {
      const next = parseBool(args[1])
      if (next === null && args[1]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `aeroport bots <on|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.ignoreBots
      await updateConfig(guild.id, { $set: { ignoreBots: enabled } })
      return message.reply({
        embeds: [
          buildAeroportEmbed(
            "check",
            "Bots",
            enabled
              ? "> *Les bots **ne déclenchent plus** les messages ni les autoroles.*"
              : "> *Les bots **déclenchent** les messages et les autoroles.*"
          ),
        ],
      })
    }

    if (head === "dm") {
      const next = parseBool(args[1])
      if (next === null) {
        const config = await getConfig(guild.id)
        return message.reply({
          components: buildAeroportContainer(client, guild, config, "dm"),
          flags: COMPONENTS_V2_FLAGS,
        })
      }
      await updateConfig(guild.id, { $set: { "dm.enabled": next } })
      return message.reply({
        embeds: [
          buildAeroportEmbed(
            "check",
            next ? "Message privé activé" : "Message privé désactivé",
            next
              ? "> *Un message privé sera envoyé à l'arrivée d'un membre.*"
              : "> *Aucun message privé ne sera envoyé à l'arrivée.*"
          ),
        ],
      })
    }

    if (head === "preview") {
      const target = parseTargetArg(args[1]) ?? "arrival"
      const config = await getConfig(guild.id)
      const member = message.member ?? (await guild.members.fetch(message.author.id).catch(() => null))
      const ctx = member ? contextFromMember(member) : null
      if (!ctx) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Impossible de générer l'aperçu.*")] })
      }
      const payload = buildMessagePayload(getTemplate(config, target), ctx)
      if (!payload) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Ce message est vide. Ajoutez un contenu ou un embed.*")],
        })
      }
      return message.reply(payload)
    }

    if (head === "autorole") {
      const action = stripAccents((args[1] ?? "").toLowerCase())
      if (action === "add" || action === "remove") {
        const id = message.mentions.roles.first()?.id ?? resolveIdFromArg(args[2] ?? "")
        if (!id) {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `aeroport autorole <add|remove> <@rôle|id>`.*")],
          })
        }
        if (id === guild.id) {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", "> *Le rôle @everyone ne peut pas être utilisé comme autorole.*")],
          })
        }
        const role = guild.roles.cache.get(id) ?? (await guild.roles.fetch(id).catch(() => null))
        if (!role) {
          return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Rôle introuvable.*")] })
        }
        if (action === "add") {
          await updateConfig(guild.id, { $addToSet: { autoroles: id } })
        } else {
          await updateConfig(guild.id, { $pull: { autoroles: id } })
        }
        return message.reply({
          embeds: [
            buildAeroportEmbed(
              "check",
              "Autorole mis à jour",
              `> ***Rôle :** ${role}*\n> ***Action :** ${action === "add" ? "Ajouté" : "Retiré"}*`
            ),
          ],
        })
      }

      const config = await getConfig(guild.id)
      if (action === "list" || !args[1]) {
        return message.reply({
          components: buildAeroportContainer(client, guild, config, "autoroles"),
          flags: COMPONENTS_V2_FLAGS,
        })
      }
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `aeroport autorole <add|remove> <@rôle|id>`.*")],
      })
    }

    if (head === "arrivee" || head === "depart") {
      const target: Exclude<TemplateTarget, "dm"> = head === "arrivee" ? "arrival" : "departure"
      const action = stripAccents((args[1] ?? "").toLowerCase())
      const enabled = parseBool(args[1])

      if (enabled !== null) {
        await updateConfig(guild.id, { $set: { [`${target}.enabled`]: enabled } })
        return message.reply({
          embeds: [
            buildAeroportEmbed(
              "check",
              `${flightLabel(target)} ${enabled ? "activée" : "désactivée"}`,
              enabled
                ? `> *Les messages de **${flightLabel(target).toLowerCase()}** sont maintenant **activés**.*`
                : `> *Les messages de **${flightLabel(target).toLowerCase()}** sont maintenant **désactivés**.*`
            ),
          ],
        })
      }

      const channelShortcut = args[1] ? resolveChannelIdFromArg(args[1]) : null
      if (action === "salon" || action === "channel" || channelShortcut) {
        const raw = channelShortcut ? args[1] : (args[2] ?? "")
        if (["off", "disable", "none", "aucun"].includes(stripAccents(raw.toLowerCase()))) {
          await updateConfig(guild.id, { $set: { [`${target}.channelId`]: null } })
          return message.reply({
            embeds: [
              buildAeroportEmbed("file", `Salon de ${flightLabel(target).toLowerCase()} retiré`, "> *Aucun salon n'est configuré.*", colors.prime),
            ],
          })
        }
        const channelId = message.mentions.channels.first()?.id ?? resolveChannelIdFromArg(raw)
        const channel = channelId
          ? (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)))
          : null
        if (!channel || !channel.isTextBased() || channel.isDMBased()) {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", `> *Salon invalide. Utilisez : \`aeroport ${head} salon <#salon|off>\`.*`)],
          })
        }
        await updateConfig(guild.id, { $set: { [`${target}.channelId`]: channel.id } })
        return message.reply({
          embeds: [
            buildAeroportEmbed(
              "file",
              `Salon de ${flightLabel(target).toLowerCase()} configuré`,
              `> ***Salon :** <#${channel.id}>*`
            ),
          ],
        })
      }

      const config = await getConfig(guild.id)
      if (!args[1]) {
        return message.reply({
          components: buildAeroportContainer(client, guild, config, viewFromTarget(target)),
          flags: COMPONENTS_V2_FLAGS,
        })
      }
      return message.reply({
        embeds: [
          buildErrorEmbed(
            "400 Bad Request",
            `> *Utilisation : \`aeroport ${head} <on|off>\` ou \`aeroport ${head} salon <#salon|off>\`.*`
          ),
        ],
      })
    }

    return sendPanel(client, message, guild)
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleAeroportInteraction(client, interaction)
  },
}
