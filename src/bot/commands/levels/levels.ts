import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import formatTime from "../../utils/formatTime.js"
import { resolveChannelIdFromArg, resolveIdFromArg, resolveTarget } from "../../utils/moderation/helpers.js"
import parseTime from "../../utils/parseTime.js"
import { applyRewardRoles } from "../../utils/levels/engine.js"
import {
  COMPONENTS_V2_FLAGS,
  buildLevelsContainer,
  buildLevelsEmbed,
  handleLevelsInteraction,
} from "../../utils/levels/dashboard.js"
import {
  MAX_LEVEL,
  MAX_NOTIFY_LENGTH,
  MAX_REWARDS,
  MAX_XP,
  MIN_REWARD_LEVEL,
  MIN_XP,
  clampCooldown,
  clampLevel,
  clampNotifyMessage,
  clampRewardLevel,
  clampXp,
  defaultConfig,
  getConfig,
  removeReward,
  resetMember,
  setMemberLevel,
  updateConfig,
  upsertReward,
} from "../../utils/levels/schema.js"

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
}

function normalizeHead(raw: string | undefined): string | null {
  if (!raw) return null
  const value = stripAccents(raw.toLowerCase())
  if (["on", "enable", "enabled", "true", "oui", "1"].includes(value)) return "on"
  if (["off", "disable", "disabled", "false", "non", "0"].includes(value)) return "off"
  if (["salon", "channel"].includes(value)) return "salon"
  if (["xp", "exp"].includes(value)) return "xp"
  if (["cooldown", "cd", "delai"].includes(value)) return "cooldown"
  if (["notify", "notif", "notification", "notifications"].includes(value)) return "notify"
  if (["message", "msg"].includes(value)) return "message"
  if (["role", "roles", "reward", "rewards"].includes(value)) return "role"
  if (["stack", "cumul"].includes(value)) return "stack"
  if (["ignore", "ignorer", "ignored"].includes(value)) return "ignore"
  if (["set", "setlevel", "niveau"].includes(value)) return "set"
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
  return message.reply({ components: buildLevelsContainer(client, guild, config), flags: COMPONENTS_V2_FLAGS })
}

export default {
  name: "levels",
  description: "Configure le système de niveaux du serveur.",
  category: "levels",
  aliases: ["niveaux", "leveling"],
  permissions: ["ManageGuild"],
  usage: "[on|off|salon|xp|cooldown|notify|message|role|stack|ignore|set|reset]",
  slash: [
    {
      name: "action",
      description: "on, off, salon, xp, cooldown, notify, message, role, stack, ignore, set, reset",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "panel", value: "panel" },
        { name: "on", value: "on" },
        { name: "off", value: "off" },
        { name: "salon", value: "salon" },
        { name: "xp", value: "xp" },
        { name: "cooldown", value: "cooldown" },
        { name: "notify", value: "notify" },
        { name: "message", value: "message" },
        { name: "role", value: "role" },
        { name: "stack", value: "stack" },
        { name: "ignore", value: "ignore" },
        { name: "set", value: "set" },
        { name: "reset", value: "reset" },
      ],
    },
    { name: "valeur", description: "on, off, durée, nombre, message…", type: ApplicationCommandOptionType.String, required: false },
    { name: "salon", description: "Salon de notification", type: ApplicationCommandOptionType.Channel, required: false },
    { name: "role", description: "Rôle de récompense", type: ApplicationCommandOptionType.Role, required: false },
    { name: "utilisateur", description: "Membre (set / reset)", type: ApplicationCommandOptionType.User, required: false },
  ],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const action = i.options.getString("action")
    if (!action) return []
    const args = [action]
    if (action === "set" || action === "reset") {
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
      `Command levels used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
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
      return message.reply({
        embeds: [
          buildLevelsEmbed(
            "check",
            enabled ? "Niveaux activés" : "Niveaux désactivés",
            enabled
              ? "> *Le gain d'XP automatique est maintenant **activé**.*"
              : "> *Le gain d'XP automatique est maintenant **désactivé**.*"
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
        return message.reply({
          embeds: [
            buildLevelsEmbed("check", "XP réinitialisée", `> *Les statistiques de <@${resolved.target.id}> ont été **effacées**.*`),
          ],
        })
      }
      const defaults = defaultConfig(guild.id)
      await updateConfig(guild.id, {
        $set: {
          enabled: defaults.enabled,
          xpMin: defaults.xpMin,
          xpMax: defaults.xpMax,
          cooldown: defaults.cooldown,
          notifyEnabled: defaults.notifyEnabled,
          notifyChannelId: defaults.notifyChannelId,
          notifyMessage: defaults.notifyMessage,
          stackRoles: defaults.stackRoles,
          ignoredChannels: defaults.ignoredChannels,
          ignoredRoles: defaults.ignoredRoles,
          rewards: defaults.rewards,
        },
      })
      return message.reply({
        embeds: [buildLevelsEmbed("check", "Niveaux réinitialisés", "> *Tous les paramètres ont été remis aux valeurs par défaut.*")],
      })
    }

    if (head === "salon") {
      const raw = args[1] ?? ""
      if (isOffArg(raw)) {
        await updateConfig(guild.id, { $set: { notifyChannelId: null } })
        return message.reply({
          embeds: [
            buildLevelsEmbed("file", "Salon retiré", "> *Les notifications seront envoyées dans le salon du message.*", colors.prime),
          ],
        })
      }
      const channelId = message.mentions.channels.first()?.id ?? resolveChannelIdFromArg(raw)
      const channel = channelId
        ? (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)))
        : null
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Salon invalide. Utilisez : `levels salon <#salon|off>`.*")],
        })
      }
      await updateConfig(guild.id, { $set: { notifyChannelId: channel.id } })
      return message.reply({
        embeds: [buildLevelsEmbed("file", "Salon configuré", `> ***Salon :** <#${channel.id}>*`)],
      })
    }

    if (head === "xp") {
      const minRaw = Number(args[1])
      const maxRaw = args[2] !== undefined ? Number(args[2]) : minRaw
      if (!Number.isInteger(minRaw) || !Number.isInteger(maxRaw) || minRaw < MIN_XP || maxRaw < MIN_XP) {
        return message.reply({
          embeds: [
            buildErrorEmbed("400 Bad Request", `> *Utilisation : \`levels xp <min> [max]\` (${MIN_XP}–${MAX_XP}).*`),
          ],
        })
      }
      let xpMin = clampXp(minRaw)
      let xpMax = clampXp(maxRaw)
      if (xpMin > xpMax) {
        const swap = xpMin
        xpMin = xpMax
        xpMax = swap
      }
      await updateConfig(guild.id, { $set: { xpMin, xpMax } })
      return message.reply({
        embeds: [buildLevelsEmbed("check", "XP mise à jour", `> ***XP par message :** \`${xpMin}\`–\`${xpMax}\`*`)],
      })
    }

    if (head === "cooldown") {
      const parsed = parseTime(args[1] ?? "")
      if (parsed === null || parsed <= 0) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Durée invalide. Utilisation : `levels cooldown <durée>` (ex. `1m`).*")],
        })
      }
      const cooldown = clampCooldown(parsed)
      await updateConfig(guild.id, { $set: { cooldown } })
      return message.reply({
        embeds: [buildLevelsEmbed("check", "Cooldown mis à jour", `> ***Cooldown :** \`${formatTime(cooldown)}\`*`)],
      })
    }

    if (head === "notify") {
      const next = parseBool(args[1])
      if (next === null && args[1]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `levels notify <on|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.notifyEnabled
      await updateConfig(guild.id, { $set: { notifyEnabled: enabled } })
      return message.reply({
        embeds: [
          buildLevelsEmbed(
            "check",
            "Notifications",
            enabled
              ? "> *Les notifications de level-up sont **activées**.*"
              : "> *Les notifications de level-up sont **désactivées**.*"
          ),
        ],
      })
    }

    if (head === "message") {
      const raw = args.slice(1).join(" ").trim()
      if (!raw) {
        return message.reply({
          embeds: [
            buildErrorEmbed(
              "400 Bad Request",
              "> *Utilisation : `levels message <texte>`.*\n> *Placeholders : `{user}`, `{level}`, `{xp}`.*"
            ),
          ],
        })
      }
      if (raw.length > MAX_NOTIFY_LENGTH) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", `> *Le message ne peut pas dépasser **${MAX_NOTIFY_LENGTH}** caractères.*`)],
        })
      }
      const notifyMessage = clampNotifyMessage(raw)
      await updateConfig(guild.id, { $set: { notifyMessage } })
      return message.reply({
        embeds: [buildLevelsEmbed("check", "Message mis à jour", `> ***Message :** ${notifyMessage}*`)],
      })
    }

    if (head === "stack") {
      const next = parseBool(args[1])
      if (next === null && args[1]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `levels stack <on|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.stackRoles
      await updateConfig(guild.id, { $set: { stackRoles: enabled } })
      return message.reply({
        embeds: [
          buildLevelsEmbed(
            "check",
            "Cumul des rôles",
            enabled
              ? "> *Tous les rôles de récompense atteints sont **conservés**.*"
              : "> *Seul le rôle de récompense **le plus élevé** est conservé.*"
          ),
        ],
      })
    }

    if (head === "ignore") {
      const raw = args[1] ?? ""
      if (isOffArg(raw) || stripAccents(raw.toLowerCase()) === "clear") {
        await updateConfig(guild.id, { $set: { ignoredChannels: [] } })
        return message.reply({
          embeds: [buildLevelsEmbed("file", "Salons ignorés", "> *Aucun salon n'est ignoré.*", colors.prime)],
        })
      }
      const channelId = message.mentions.channels.first()?.id ?? resolveChannelIdFromArg(raw)
      const channel = channelId
        ? (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)))
        : null
      if (!channel || channel.isDMBased()) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `levels ignore <#salon|off>`.*")],
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
          buildLevelsEmbed(
            "file",
            "Salons ignorés",
            ignoredChannels.length
              ? `> ***Salons :** ${ignoredChannels.map((id) => `<#${id}>`).join(" ")}*`
              : "> *Aucun salon n'est ignoré.*"
          ),
        ],
      })
    }

    if (head === "role") {
      const first = args[1] ?? ""
      const second = args[2] ?? ""
      if (!first) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `levels role <niveau> <@rôle>` ou `levels role off <@rôle>`.*")],
        })
      }

      const offToken = isOffArg(first) ? first : isOffArg(second) ? second : null
      const roleToken = offToken === first ? second : isOffArg(second) ? first : /^\d+$/.test(first) ? second : first
      const levelToken = /^\d+$/.test(first) ? first : /^\d+$/.test(second) ? second : null

      const id = message.mentions.roles.first()?.id ?? resolveIdFromArg(roleToken)
      if (!id) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `levels role <niveau> <@rôle>` ou `levels role off <@rôle>`.*")],
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
          embeds: [buildLevelsEmbed("file", "Rôle retiré", `> *Le rôle ${role} n'est plus une récompense.*`, colors.prime)],
        })
      }

      if (!levelToken) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `levels role <niveau> <@rôle>`.*")],
        })
      }
      const rawLevel = Number(levelToken)
      if (!Number.isInteger(rawLevel) || rawLevel < MIN_REWARD_LEVEL || rawLevel > MAX_LEVEL) {
        return message.reply({
          embeds: [
            buildErrorEmbed(
              "400 Bad Request",
              `> *Niveau invalide. Utilisez un entier entre **${MIN_REWARD_LEVEL}** et **${MAX_LEVEL}**.*`
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
      const level = clampRewardLevel(rawLevel)
      await updateConfig(guild.id, { $set: { rewards: upsertReward(config.rewards, role.id, level) } })
      return message.reply({
        embeds: [buildLevelsEmbed("file", "Rôle configuré", `> ***Récompense :** ${role} au niveau \`${level}\`*`)],
      })
    }

    if (head === "set") {
      const resolved = await resolveTarget(client, guild, args[1] ?? "", false)
      if (!resolved.ok) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `levels set <@utilisateur> <niveau>`.*")],
        })
      }
      const rawLevel = Number(args[2])
      if (!Number.isInteger(rawLevel) || rawLevel < 0 || rawLevel > MAX_LEVEL) {
        return message.reply({
          embeds: [
            buildErrorEmbed("400 Bad Request", `> *Niveau invalide. Utilisez un entier entre **0** et **${MAX_LEVEL}**.*`),
          ],
        })
      }
      const level = clampLevel(rawLevel)
      const stats = await setMemberLevel(guild.id, resolved.target.id, level)
      const member =
        resolved.target.member ??
        (guild.members.cache.get(resolved.target.id) ?? (await guild.members.fetch(resolved.target.id).catch(() => null)))
      if (member) {
        const config = await getConfig(guild.id)
        await applyRewardRoles(member, config, stats.level)
      }
      return message.reply({
        embeds: [
          buildLevelsEmbed(
            "check",
            "Niveau défini",
            `> ***Membre :** <@${resolved.target.id}>*\n> ***Niveau :** \`${stats.level}\`*\n> ***XP :** \`${stats.xp}\`*`
          ),
        ],
      })
    }

    return sendPanel(client, message, guild)
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleLevelsInteraction(client, interaction)
  },
}
