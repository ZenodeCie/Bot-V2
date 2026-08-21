import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import formatTime from "../../utils/formatTime.js"
import { resolveChannelIdFromArg, resolveIdFromArg } from "../../utils/moderation/helpers.js"
import parseTime from "../../utils/parseTime.js"
import {
  COMPONENTS_V2_FLAGS,
  buildCaptchaContainer,
  buildCaptchaEmbed,
  clampAttempts,
  clampTimeout,
  handleCaptchaInteraction,
} from "../../utils/captcha/dashboard.js"
import { defaultConfig, getConfig, updateConfig } from "../../utils/captcha/schema.js"

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
  if (["timeout", "duree", "duration", "delai"].includes(value)) return "timeout"
  if (["attempts", "essais", "essai", "tries"].includes(value)) return "attempts"
  if (["kick", "expulser", "expulsion"].includes(value)) return "kick"
  if (["bots", "bot", "ignorebots"].includes(value)) return "bots"
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
  return message.reply({ components: buildCaptchaContainer(client, guild, config), flags: COMPONENTS_V2_FLAGS })
}

export default {
  name: "captcha",
  description: "Configure la vérification anti-bot à l'arrivée.",
  category: "captcha",
  aliases: ["verify", "verification"],
  permissions: ["ManageGuild"],
  usage: "[on|off|salon|role|timeout|attempts|kick|bots|reset]",
  slash: [
    {
      name: "action",
      description: "on, off, salon, role, timeout, attempts, kick, bots, reset",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "panel", value: "panel" },
        { name: "on", value: "on" },
        { name: "off", value: "off" },
        { name: "salon", value: "salon" },
        { name: "role", value: "role" },
        { name: "timeout", value: "timeout" },
        { name: "attempts", value: "attempts" },
        { name: "kick", value: "kick" },
        { name: "bots", value: "bots" },
        { name: "reset", value: "reset" },
      ],
    },
    { name: "valeur", description: "on, off, durée, nombre…", type: ApplicationCommandOptionType.String, required: false },
    { name: "salon", description: "Salon de vérification", type: ApplicationCommandOptionType.Channel, required: false },
    { name: "role", description: "Rôle vérifié", type: ApplicationCommandOptionType.Role, required: false },
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
      `Command captcha used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
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
      if (enabled && !config.channelId) missing.push("salon")
      if (enabled && !config.roleId) missing.push("rôle")
      return message.reply({
        embeds: [
          buildCaptchaEmbed(
            "check",
            enabled ? "Captcha activé" : "Captcha désactivé",
            enabled
              ? `> *La vérification à l'arrivée est maintenant **activée**.*` +
                  (missing.length > 0 ? `\n> *Configurez encore : **${missing.join("** et **")}**.*` : "")
              : "> *La vérification à l'arrivée est maintenant **désactivée**.*"
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
          roleId: defaults.roleId,
          timeout: defaults.timeout,
          maxAttempts: defaults.maxAttempts,
          kickOnFail: defaults.kickOnFail,
          ignoreBots: defaults.ignoreBots,
        },
      })
      return message.reply({
        embeds: [buildCaptchaEmbed("check", "Captcha réinitialisé", "> *Tous les paramètres ont été remis aux valeurs par défaut.*")],
      })
    }

    if (head === "salon") {
      const raw = args[1] ?? ""
      if (isOffArg(raw)) {
        await updateConfig(guild.id, { $set: { channelId: null } })
        return message.reply({
          embeds: [buildCaptchaEmbed("file", "Salon retiré", "> *Aucun salon n'est configuré.*", colors.prime)],
        })
      }
      const channelId = message.mentions.channels.first()?.id ?? resolveChannelIdFromArg(raw)
      const channel = channelId
        ? (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)))
        : null
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Salon invalide. Utilisez : `captcha salon <#salon|off>`.*")],
        })
      }
      await updateConfig(guild.id, { $set: { channelId: channel.id } })
      return message.reply({
        embeds: [buildCaptchaEmbed("file", "Salon configuré", `> ***Salon :** <#${channel.id}>*`)],
      })
    }

    if (head === "role") {
      const raw = args[1] ?? ""
      if (isOffArg(raw)) {
        await updateConfig(guild.id, { $set: { roleId: null } })
        return message.reply({
          embeds: [buildCaptchaEmbed("file", "Rôle retiré", "> *Aucun rôle n'est configuré.*", colors.prime)],
        })
      }
      const id = message.mentions.roles.first()?.id ?? resolveIdFromArg(raw)
      if (!id) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `captcha role <@rôle|id|off>`.*")],
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
      return message.reply({
        embeds: [buildCaptchaEmbed("file", "Rôle configuré", `> ***Rôle :** ${role}*`)]
      })
    }

    if (head === "timeout") {
      const parsed = parseTime(args[1] ?? "")
      if (parsed === null || parsed <= 0) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Durée invalide. Utilisation : `captcha timeout <durée>` (ex. `5m`).*")],
        })
      }
      const timeout = clampTimeout(parsed)
      await updateConfig(guild.id, { $set: { timeout } })
      return message.reply({
        embeds: [buildCaptchaEmbed("check", "Délai mis à jour", `> ***Délai :** \`${formatTime(timeout)}\`*`)],
      })
    }

    if (head === "attempts") {
      const raw = Number(args[1])
      if (!Number.isInteger(raw) || raw < 1) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `captcha attempts <n>`.*")],
        })
      }
      const maxAttempts = clampAttempts(raw)
      await updateConfig(guild.id, { $set: { maxAttempts } })
      return message.reply({
        embeds: [buildCaptchaEmbed("check", "Essais mis à jour", `> ***Essais :** \`${maxAttempts}\`*`)],
      })
    }

    if (head === "kick") {
      const next = parseBool(args[1])
      if (next === null && args[1]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `captcha kick <on|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.kickOnFail
      await updateConfig(guild.id, { $set: { kickOnFail: enabled } })
      return message.reply({
        embeds: [
          buildCaptchaEmbed(
            "check",
            "Expulsion",
            enabled
              ? "> *Les membres seront **expulsés** en cas d'échec ou d'expiration.*"
              : "> *Les membres **resteront** sur le serveur sans le rôle en cas d'échec.*"
          ),
        ],
      })
    }

    if (head === "bots") {
      const next = parseBool(args[1])
      if (next === null && args[1]) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `captcha bots <on|off>`.*")],
        })
      }
      const config = await getConfig(guild.id)
      const enabled = next ?? !config.ignoreBots
      await updateConfig(guild.id, { $set: { ignoreBots: enabled } })
      return message.reply({
        embeds: [
          buildCaptchaEmbed(
            "check",
            "Bots",
            enabled
              ? "> *Les bots **ne déclenchent plus** le captcha.*"
              : "> *Les bots **déclenchent** le captcha.*"
          ),
        ],
      })
    }

    return sendPanel(client, message, guild)
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleCaptchaInteraction(client, interaction)
  },
}
