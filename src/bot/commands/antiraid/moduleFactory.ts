import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, MessageFlags } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import formatTime from "../../utils/formatTime.js"
import parseTime from "../../utils/parseTime.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { buildModuleContainer, handleModuleInteraction } from "../../utils/antiraid/dashboard.js"
import {
  AntiRaid,
  MODULE_LABELS,
  PUNISHMENT_LABELS,
  PUNISHMENTS,
  getConfig,
  type AntiRaidConfig,
  type ModuleName,
  type Punishment,
} from "../../utils/antiraid/schema.js"

export interface ModuleCommandOptions {
  name: string
  description: string
  module: ModuleName
  aliases?: string[]
  usage?: string
  textActions?: Record<string, (client: Client, message: Message, args: string[], config: AntiRaidConfig) => Promise<unknown>>
}

async function runCommonModuleAction(
  client: Client,
  message: Message,
  args: string[],
  config: AntiRaidConfig,
  moduleName: ModuleName
): Promise<unknown> {
  const guildId = message.guild!.id
  const action = args[0]?.toLowerCase()
  const module = config.modules[moduleName]
  const label = MODULE_LABELS[moduleName]

  if (action === "on" || action === "enable") {
    await AntiRaid.findOneAndUpdate({ guildId }, { $set: { [`modules.${moduleName}.enabled`]: true, mode: "custom" } }, { upsert: true })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({
      embeds: [buildAntiRaidEmbed("check", "Module activé", `> ***Module:** ${label} (\`${moduleName}\`)*\n> *La protection est maintenant **activée**.*`)],
    })
  }

  if (action === "off" || action === "disable") {
    await AntiRaid.findOneAndUpdate({ guildId }, { $set: { [`modules.${moduleName}.enabled`]: false, mode: "custom" } }, { upsert: true })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({
      embeds: [buildAntiRaidEmbed("power", "Module désactivé", `> ***Module:** ${label} (\`${moduleName}\`)*\n> *La protection est maintenant **désactivée**.*`)],
    })
  }

  if (action === "threshold" || action === "limit") {
    const count = Number(args[1])
    if (!Number.isInteger(count) || count < 1) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Le nombre d'actions doit être un entier supérieur ou égal à 1.*")] })
    }
    await AntiRaid.findOneAndUpdate({ guildId }, { $set: { [`modules.${moduleName}.limit`]: count, mode: "custom" } }, { upsert: true })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({
      embeds: [buildAntiRaidEmbed("check", "Seuil mis à jour", `> ***Module:** ${label}*\n> ***Seuil:** \`${count}\` actions*`)],
    })
  }

  if (action === "interval") {
    const interval = parseTime(args[1] ?? "")
    if (interval === null || interval <= 0) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Durée invalide. Exemples : `5s`, `10m`, `1h`.*")] })
    }
    await AntiRaid.findOneAndUpdate({ guildId }, { $set: { [`modules.${moduleName}.interval`]: interval, mode: "custom" } }, { upsert: true })
    client.antiraid.invalidateConfig(guildId)
    return message.reply({
      embeds: [buildAntiRaidEmbed("check", "Intervalle mis à jour", `> ***Module:** ${label}*\n> ***Intervalle:** \`${formatTime(interval)}\`*`)],
    })
  }

  if (action === "action" || action === "punish") {
    const punishment = args[1]?.toLowerCase() as Punishment
    if (!PUNISHMENTS.includes(punishment)) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", `> *Punition inconnue. Punitions disponibles : ${PUNISHMENTS.map((p) => `\`${p}\``).join(", ")}.*`)],
      })
    }
    let duration = module.duration
    if ((punishment === "timeout" || punishment === "lockdown") && duration <= 0) duration = 600000
    if (punishment !== "timeout" && punishment !== "lockdown") duration = 0
    await AntiRaid.findOneAndUpdate(
      { guildId },
      { $set: { [`modules.${moduleName}.punishment`]: punishment, [`modules.${moduleName}.duration`]: duration, mode: "custom" } },
      { upsert: true }
    )
    client.antiraid.invalidateConfig(guildId)
    const durationText =
      duration > 0 && (punishment === "timeout" || punishment === "lockdown") ? ` (durée : \`${formatTime(duration)}\`)` : ""
    return message.reply({
      embeds: [
        buildAntiRaidEmbed(
          "check",
          "Punition mise à jour",
          `> ***Module:** ${label}*\n> ***Punition:** **${PUNISHMENT_LABELS[punishment]}**${durationText}*`
        ),
      ],
    })
  }

  return undefined
}

export function createModuleCommand(options: ModuleCommandOptions) {
  return {
    name: options.name,
    description: options.description,
    category: "antiraid",
    aliases: options.aliases ?? [],
    permissions: ["Administrator"],
    usage: options.usage ?? "[on|off|threshold|interval|action]",
    slashRegister: false,
    slash: [
      { name: "action", description: "on, off, threshold, interval, action…", type: ApplicationCommandOptionType.String, required: false },
      { name: "valeur", description: "Seuil, durée, punition ou extra", type: ApplicationCommandOptionType.String, required: false },
    ],
    async execute(client: Client, message: Message, args: string[]) {
      console.log(`Command ${options.name} used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`)

      if (!message.guild) {
        return message.reply({
          embeds: [buildErrorEmbed("Erreur", "> *Cette commande doit être exécutée dans un serveur.*")],
        })
      }

      const config = await getConfig(message.guild.id)
      const action = args[0]?.toLowerCase()
      if (action && options.textActions?.[action]) {
        return options.textActions[action](client, message, args, config)
      }

      const handled = await runCommonModuleAction(client, message, args, config, options.module)
      if (handled !== undefined) return handled

      return message.reply({ components: buildModuleContainer(client, message.guild as Guild, config, options.module), flags: MessageFlags.IsComponentsV2 })
    },
    async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
      return handleModuleInteraction(client, interaction, options.module)
    },
  }
}
