import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import formatTime from "../../utils/formatTime.js"
import { resolveChannelIdFromArg, resolveIdFromArg, resolveTarget } from "../../utils/moderation/helpers.js"
import parseTime from "../../utils/parseTime.js"
import { applyRewardRoles } from "../../utils/invitations/engine.js"
import {
  COMPONENTS_V2_FLAGS,
  buildInvitationsContainer,
  buildInvitationsEmbed,
  handleInvitationsInteraction,
} from "../../utils/invitations/dashboard.js"
import {
  MAX_REWARDS,
  MAX_REWARD_INVITES,
  MIN_REWARD_INVITES,
  addBonus,
  clampFakeAge,
  clampRewardInvites,
  defaultConfig,
  getConfig,
  getMemberInvites,
  removeReward,
  resetMember,
  updateConfig,
  upsertReward,
} from "../../utils/invitations/schema.js"

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
}

function normalizeHead(raw: string | undefined): string | null {
  if (!raw) return null
  const value = stripAccents(raw.toLowerCase())
  if (["on", "enable", "enabled", "true", "oui", "1"].includes(value)) return "on"
  if (["off", "disable", "disabled", "false", "non", "0"].includes(value)) return "off"
  if (["salon", "channel", "logs"].includes(value)) return "salon"
  if (["fake", "fakes", "age"].includes(value)) return "fake"
  if (["bots", "bot", "ignorebots"].includes(value)) return "bots"
  if (["rejoins", "rejoin", "reinvite"].includes(value)) return "rejoins"
  if (["role", "roles", "reward", "rewards"].includes(value)) return "role"
  if (["stack", "cumul"].includes(value)) return "stack"
  if (["add", "bonus", "addbonus", "ajouter"].includes(value)) return "add"
  if (["remove", "rm", "removebonus", "retirer"].includes(value)) return "remove"
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
  return message.reply({ components: buildInvitationsContainer(client, guild, config), flags: COMPONENTS_V2_FLAGS })
}

async function refreshInviterRoles(guild: Guild, userId: string): Promise<void> {
  const config = await getConfig(guild.id)
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null))
  if (!member) return
  const stats = await getMemberInvites(guild.id, userId)
  await applyRewardRoles(member, config, stats)
}

export default {
  name: "invitations",
  description: "Configure le suivi des invitations du serveur.",
  category: "invitations",
  slashName: "config",
  aliases: ["inviteconfig", "invitelogs"],
  permissions: ["ManageGuild"],
  usage: "[on|off|salon|fake|bots|rejoins|role|stack|add|remove|reset]",
  slash: [
    {
      name: "action",
      description: "on, off, salon, fake, bots, rejoins, role, stack, add, remove, reset",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "panel", value: "panel" },
        { name: "on", value: "on" },
        { name: "off", value: "off" },
        { name: "salon", value: "salon" },
        { name: "fake", value: "fake" },
        { name: "bots", value: "bots" },
        { name: "rejoins", value: "rejoins" },
        { name: "role", value: "role" },
        { name: "stack", value: "stack" },
        { name: "add", value: "add" },
        { name: "remove", value: "remove" },
        { name: "reset", value: "reset" },
      ],
    },
    { name: "valeur", description: "on, off, durée, nombre…", type: ApplicationCommandOptionType.String, required: false },
    { name: "salon", description: "Salon de logs", type: ApplicationCommandOptionType.Channel, required: false },
    { name: "role", description: "Rôle de récompense", type: ApplicationCommandOptionType.Role, required: false },
    { name: "utilisateur", description: "Membre (add / remove / reset)", type: ApplicationCommandOptionType.User, required: false },
  ],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const action = i.options.getString("action")
    if (!action) return []
    const args = [action]
    if (action === "add" || action === "remove" || action === "reset") {
      const user = i.options.getUser("utilisateur")
      if (user) args.push(user.id)
      const valeur = i.options.getString("valeur")
      if (valeur) args.push(valeur)
      return args
    }
    if (action === "role") {
      const valeur = i.options.getString("valeur")
      if (valeur) args.push(valeur)
      const role = i.options.getRole("role")
      if (role) args.push(role.id)
      return args
    }
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
      `Command invitations used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
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
      const missing: string[] = []
      if (enabled && !config.logChannelId) missing.push("salon de logs")
      return message.reply({
        embeds: [
          buildInvitationsEmbed(
            "check",
            enabled ? "Invitations activées" : "Invitations désactivées",
            enabled
              ? `> *Le suivi des invitations est maintenant **activé**.*` +
                  (missing.length > 0 ? `\n> *Configurez encore : **${missing.join("** et **")}**.*` : "")
              : "> *Le suivi des invitations est maintenant **désactivé**.*"
          ),
        ],
      })
    }

    if (head === "reset") {
      const rawUser = args[1]
      if (rawUser) {
        const resolved = await resolveTarget(client, guild, rawUser, false)
        if (!resolved.ok) {
          return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", `> *${resolved.error}*`)] })
        }
        await resetMember(guild.id, resolved.target.id)
        await refreshInviterRoles(guild, resolved.target.id)
        return message.reply({
          embeds: [
            buildInvitationsEmbed(
              "check",
              "Invitations réinitialisées",
              `> *Les invitations de <@${resolved.target.id}> ont été **effacées**.*`
            ),
          ],
        })
      }
      const defaults = defaultConfig(guild.id)
      await updateConfig(guild.id, {
        $set: {
          enabled: defaults.enabled,
          logChannelId: defaults.logChannelId,
          fakeAge: defaults.fakeAge,
          ignoreBots: defaults.ignoreBots,
          countRejoins: defaults.countRejoins,
          stackRoles: defaults.stackRoles,
          rewards: defaults.rewards,
        },
      })
      return message.reply({
        embeds: [
          buildInvitationsEmbed("check", "Invitations réinitialisées", "> *Tous les paramètres ont été remis aux valeurs par défaut.*"),
        ],
      })
    }

    if (head === "salon") {
      const raw = args[1] ?? ""
      if (isOffArg(raw)) {
        await updateConfig(guild.id, { $set: { logChannelId: null } })
        return message.reply({
          embeds: [buildInvitationsEmbed("file", "Salon retiré", "> *Aucun salon de logs n'est configuré.*", colors.prime)],
        })
      }
      const channelId = message.mentions.channels.first()?.id ?? resolveChannelIdFromArg(raw)
      const channel = channelId
        ? (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)))
        : null
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Salon invalide. Utilisez : `invitations salon <#salon|off>`.*")],
        })
      }
      await updateConfig(guild.id, { $set: { logChannelId: channel.id } })
      return message.reply({
        embeds: [buildInvitationsEmbed("file", "Salon configuré", `> ***Salon :** <#${channel.id}>*`)],
      })
    }

    if (head === "fake") {
      const raw = args[1] ?? ""
      if (isOffArg(raw) || raw === "0") {
        await updateConfig(guild.id, { $set: { fakeAge: 0 } })
        return message.reply({
          embeds: [
            buildInvitationsEmbed("file", "Comptes fake", "> *Aucun compte n'est marqué fake selon son âge.*", colors.prime),
          ],
        })
      }
      const parsed = parseTime(raw)
      if (parsed === null || parsed < 0) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Durée invalide. Utilisation : `invitations fake <durée|off>` (ex. `7d`).*")],
        })
      }
      const fakeAge = clampFakeAge(parsed)
      await updateConfig(guild.id, { $set: { fakeAge } })
      return message.reply({
        embeds: [
          buildInvitationsEmbed(
            "check",
            "Comptes fake",
            fakeAge > 0
              ? `> *Les comptes de moins de \`${formatTime(fakeAge)}\` sont comptés comme **fake**.*`
              : "> *Aucun compte n'est marqué fake selon son âge.*"
          ),
        ],
      })
    }

    if (head === "bots") {
      const next = parseBool(args[1])
      if (next === null && args[1]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `invitations bots <on|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.ignoreBots
      await updateConfig(guild.id, { $set: { ignoreBots: enabled } })
      return message.reply({
        embeds: [
          buildInvitationsEmbed(
            "check",
            "Bots",
            enabled
              ? "> *Les bots **ne sont plus** comptés dans les invitations.*"
              : "> *Les bots **sont comptés** dans les invitations.*"
          ),
        ],
      })
    }

    if (head === "rejoins") {
      const next = parseBool(args[1])
      if (next === null && args[1]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `invitations rejoins <on|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.countRejoins
      await updateConfig(guild.id, { $set: { countRejoins: enabled } })
      return message.reply({
        embeds: [
          buildInvitationsEmbed(
            "check",
            "Rejoins",
            enabled
              ? "> *Un membre qui **revient** donne une nouvelle invitation.*"
              : "> *Un membre qui **revient** n'est pas recompté.*"
          ),
        ],
      })
    }

    if (head === "stack") {
      const next = parseBool(args[1])
      if (next === null && args[1]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `invitations stack <on|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.stackRoles
      await updateConfig(guild.id, { $set: { stackRoles: enabled } })
      return message.reply({
        embeds: [
          buildInvitationsEmbed(
            "check",
            "Cumul des rôles",
            enabled
              ? "> *Tous les rôles de récompense atteints sont **conservés**.*"
              : "> *Seul le rôle de récompense **le plus élevé** est conservé.*"
          ),
        ],
      })
    }

    if (head === "role") {
      const first = args[1] ?? ""
      const second = args[2] ?? ""
      if (!first) {
        return message.reply({
          embeds: [
            buildErrorEmbed("400 Bad Request", "> *Utilisation : `invitations role <invites> <@rôle>` ou `invitations role off <@rôle>`.*"),
          ],
        })
      }

      const offToken = isOffArg(first) ? first : isOffArg(second) ? second : null
      const roleToken = offToken === first ? second : isOffArg(second) ? first : /^\d+$/.test(first) ? second : first
      const invitesToken = /^\d+$/.test(first) ? first : /^\d+$/.test(second) ? second : null

      const id = message.mentions.roles.first()?.id ?? resolveIdFromArg(roleToken)
      if (!id) {
        return message.reply({
          embeds: [
            buildErrorEmbed("400 Bad Request", "> *Utilisation : `invitations role <invites> <@rôle>` ou `invitations role off <@rôle>`.*"),
          ],
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

      if (offToken) {
        const config = await getConfig(guild.id)
        await updateConfig(guild.id, { $set: { rewards: removeReward(config.rewards, role.id) } })
        return message.reply({
          embeds: [buildInvitationsEmbed("file", "Rôle retiré", `> *Le rôle ${role} n'est plus une récompense.*`, colors.prime)],
        })
      }

      if (!invitesToken) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `invitations role <invites> <@rôle>`.*")],
        })
      }
      const rawInvites = Number(invitesToken)
      if (!Number.isInteger(rawInvites) || rawInvites < MIN_REWARD_INVITES || rawInvites > MAX_REWARD_INVITES) {
        return message.reply({
          embeds: [
            buildErrorEmbed(
              "400 Bad Request",
              `> *Nombre invalide. Utilisez un entier entre **${MIN_REWARD_INVITES}** et **${MAX_REWARD_INVITES}**.*`
            ),
          ],
        })
      }
      const config = await getConfig(guild.id)
      if (config.rewards.length >= MAX_REWARDS && !config.rewards.some((item) => item.roleId === role.id)) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", `> *Maximum **${MAX_REWARDS}** rôles de récompense.*`)],
        })
      }
      const invites = clampRewardInvites(rawInvites)
      await updateConfig(guild.id, { $set: { rewards: upsertReward(config.rewards, role.id, invites) } })
      return message.reply({
        embeds: [buildInvitationsEmbed("file", "Rôle configuré", `> ***Récompense :** ${role} à \`${invites}\` invites*`)],
      })
    }

    if (head === "add" || head === "remove") {
      const resolved = await resolveTarget(client, guild, args[1] ?? "", false)
      if (!resolved.ok) {
        return message.reply({
          embeds: [
            buildErrorEmbed("400 Bad Request", `> *Utilisation : \`invitations ${head} <@utilisateur> <nombre>\`.*`),
          ],
        })
      }
      const rawAmount = Number(args[2])
      if (!Number.isInteger(rawAmount) || rawAmount <= 0) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Indiquez un entier **strictement positif**.*")],
        })
      }
      const delta = head === "add" ? rawAmount : -rawAmount
      const stats = await addBonus(guild.id, resolved.target.id, delta)
      await refreshInviterRoles(guild, resolved.target.id)
      return message.reply({
        embeds: [
          buildInvitationsEmbed(
            "check",
            head === "add" ? "Bonus ajouté" : "Bonus retiré",
            `> ***Membre :** <@${resolved.target.id}>*\n> ***Bonus :** \`${stats.bonus}\`*`
          ),
        ],
      })
    }

    return sendPanel(client, message, guild)
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleInvitationsInteraction(client, interaction)
  },
}
