import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { resolveChannelIdFromArg, resolveIdFromArg } from "../../utils/moderation/helpers.js"
import {
  COMPONENTS_V2_FLAGS,
  buildStaffListContainer,
  buildStaffListEmbed,
  handleStaffListInteraction,
} from "../../utils/stafflist/dashboard.js"
import { publishStaffList, republishIfPublished } from "../../utils/stafflist/engine.js"
import { MAX_ROLES, clampTitle, defaultConfig, getConfig, updateConfig } from "../../utils/stafflist/schema.js"

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
  if (["statut", "status"].includes(value)) return "statut"
  if (["bots", "bot", "ignorebots"].includes(value)) return "bots"
  if (["titre", "title"].includes(value)) return "titre"
  if (["publish", "publier", "actualiser", "refresh", "update"].includes(value)) return "publish"
  if (["reset", "clear"].includes(value)) return "reset"
  if (["panel", "config"].includes(value)) return "panel"
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
    components: buildStaffListContainer(client, guild, config),
    flags: COMPONENTS_V2_FLAGS,
  })
}

export default {
  name: "stafflist",
  description: "Configure la liste automatique du staff.",
  category: "stafflist",
  aliases: ["staff", "listestaff"],
  permissions: ["ManageGuild"],
  usage: "[on|off|salon|role|statut|bots|titre|publish|reset]",
  slash: [
    {
      name: "action",
      description: "on, off, salon, role, statut, bots, titre, publish, reset",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "panel", value: "panel" },
        { name: "on", value: "on" },
        { name: "off", value: "off" },
        { name: "salon", value: "salon" },
        { name: "role", value: "role" },
        { name: "statut", value: "statut" },
        { name: "bots", value: "bots" },
        { name: "titre", value: "titre" },
        { name: "publish", value: "publish" },
        { name: "reset", value: "reset" },
      ],
    },
    { name: "valeur", description: "on, off, add, remove, titre…", type: ApplicationCommandOptionType.String, required: false },
    { name: "salon", description: "Salon de la liste", type: ApplicationCommandOptionType.Channel, required: false },
    { name: "role", description: "Rôle staff", type: ApplicationCommandOptionType.Role, required: false },
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
      `Command stafflist used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
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
      if (enabled && config.roleIds.length === 0) missing.push("rôle")
      return message.reply({
        embeds: [
          buildStaffListEmbed(
            "check",
            enabled ? "Liste activée" : "Liste désactivée",
            enabled
              ? `> *La liste du staff est maintenant **activée**.*` +
                  (missing.length > 0
                    ? `\n> *Configurez encore : **${missing.join("** et **")}**.*`
                    : `\n> ***Salon :** <#${config.channelId}>*`)
              : "> *La liste du staff est maintenant **désactivée**.*"
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
          roleIds: defaults.roleIds,
          showStatus: defaults.showStatus,
          ignoreBots: defaults.ignoreBots,
        },
      })
      return message.reply({
        embeds: [buildStaffListEmbed("check", "Liste réinitialisée", "> *Tous les paramètres ont été remis aux valeurs par défaut.*")],
      })
    }

    if (head === "salon") {
      const raw = args[1] ?? ""
      if (isOffArg(raw)) {
        await updateConfig(guild.id, { $set: { channelId: null, messageId: null } })
        return message.reply({
          embeds: [buildStaffListEmbed("file", "Salon retiré", "> *Aucun salon n'est configuré.*", colors.prime)],
        })
      }
      const channelId = message.mentions.channels.first()?.id ?? resolveChannelIdFromArg(raw)
      const channel = channelId
        ? (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)))
        : null
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Salon invalide. Utilisez : `stafflist salon <#salon|off>`.*")],
        })
      }
      await updateConfig(guild.id, { $set: { channelId: channel.id, messageId: null } })
      await republishIfPublished(client, guild.id)
      return message.reply({
        embeds: [buildStaffListEmbed("file", "Salon configuré", `> ***Salon :** <#${channel.id}>*`)],
      })
    }

    if (head === "role") {
      const action = stripAccents((args[1] ?? "").toLowerCase())
      if (action === "add" || action === "remove") {
        const id = message.mentions.roles.first()?.id ?? resolveIdFromArg(args[2] ?? "")
        if (!id) {
          return message.reply({
            embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `stafflist role <add|remove> <@rôle|id>`.*")],
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
        if (action === "add") {
          const current = await getConfig(guild.id)
          if (!current.roleIds.includes(id) && current.roleIds.length >= MAX_ROLES) {
            return message.reply({
              embeds: [buildErrorEmbed("400 Bad Request", `> *Maximum **${MAX_ROLES}** rôles staff.*`)],
            })
          }
          await updateConfig(guild.id, { $addToSet: { roleIds: id } })
        } else {
          await updateConfig(guild.id, { $pull: { roleIds: id } })
        }
        await republishIfPublished(client, guild.id)
        return message.reply({
          embeds: [
            buildStaffListEmbed(
              "check",
              "Rôle mis à jour",
              `> ***Rôle :** ${role}*\n> ***Action :** ${action === "add" ? "Ajouté" : "Retiré"}*`
            ),
          ],
        })
      }

      if (isOffArg(args[1])) {
        await updateConfig(guild.id, { $set: { roleIds: [] } })
        await republishIfPublished(client, guild.id)
        return message.reply({
          embeds: [buildStaffListEmbed("file", "Rôles retirés", "> *Aucun rôle staff n'est configuré.*", colors.prime)],
        })
      }

      return sendPanel(client, message, guild)
    }

    if (head === "statut") {
      const next = parseBool(args[1])
      if (next === null && args[1]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `stafflist statut <on|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.showStatus
      await updateConfig(guild.id, { $set: { showStatus: enabled } })
      await republishIfPublished(client, guild.id)
      return message.reply({
        embeds: [
          buildStaffListEmbed(
            "check",
            "Statut",
            enabled
              ? "> *Le statut en ligne/hors ligne est maintenant **affiché**.*"
              : "> *Le statut en ligne/hors ligne est maintenant **masqué**.*"
          ),
        ],
      })
    }

    if (head === "bots") {
      const next = parseBool(args[1])
      if (next === null && args[1]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `stafflist bots <on|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.ignoreBots
      await updateConfig(guild.id, { $set: { ignoreBots: enabled } })
      await republishIfPublished(client, guild.id)
      return message.reply({
        embeds: [
          buildStaffListEmbed(
            "check",
            "Bots",
            enabled
              ? "> *Les bots **n'apparaissent plus** dans la liste.*"
              : "> *Les bots **apparaissent** dans la liste.*"
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
          buildStaffListEmbed(
            "check",
            "Titre mis à jour",
            title ? `> ***Titre :** ${title}*` : "> *Le titre utilisera **Liste du Staff**.*"
          ),
        ],
      })
    }

    if (head === "publish") {
      const result = await publishStaffList(client, guild.id)
      if (!result.ok) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", result.error)] })
      }
      return message.reply({
        embeds: [
          buildStaffListEmbed(
            "check",
            "Liste publiée",
            `> ***Salon :** <#${result.config.channelId}>*\n> *Le message a été envoyé ou mis à jour.*`
          ),
        ],
      })
    }

    return sendPanel(client, message, guild)
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleStaffListInteraction(client, interaction)
  },
}
