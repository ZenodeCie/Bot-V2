import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, MessageFlags, type ChatInputCommandInteraction } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { buildHoneypotContainer, handleHoneypotInteraction } from "../../utils/antiraid/dashboard.js"
import { AntiRaid, PUNISHMENT_LABELS, PUNISHMENTS, getConfig, type Punishment } from "../../utils/antiraid/schema.js"

export default {
  name: "honeypot",
  description: "Configure le système piège (honeypot) anti-intrus.",
  category: "antiraid",
  slashRegister: false,
  aliases: ["hp"],
  permissions: ["Administrator"],
  usage: "[enable|disable|add channel <#salon>|remove channel <#salon>|add role <@rôle>|remove role <@rôle>|action <punition>]",
  slash: [
    {
      name: "action",
      description: "Action",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "enable", value: "enable" },
        { name: "disable", value: "disable" },
        { name: "add", value: "add" },
        { name: "remove", value: "remove" },
        { name: "action", value: "action" },
      ],
    },
    {
      name: "cible",
      description: "channel ou role (pour add/remove)",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "channel", value: "channel" },
        { name: "role", value: "role" },
      ],
    },
    { name: "salon", description: "Salon piège", type: ApplicationCommandOptionType.Channel, required: false },
    { name: "role", description: "Rôle piège", type: ApplicationCommandOptionType.Role, required: false },
    { name: "punition", description: "Punition (si action)", type: ApplicationCommandOptionType.String, required: false },
  ],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const action = i.options.getString("action")
    if (!action) return []
    if (action === "action") return ["action", i.options.getString("punition") ?? ""]
    if (action === "add" || action === "remove") {
      const kind = i.options.getString("cible") ?? (i.options.getRole("role") ? "role" : "channel")
      const id = i.options.getChannel("salon")?.id ?? i.options.getRole("role")?.id ?? ""
      return [action, kind, id]
    }
    return [action]
  },
  async execute(client: Client, message: Message, args: string[]) {
    console.log(`Command honeypot used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`)

    if (!message.guild) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")] })
    }

    const guildId = message.guild.id
    const action = args[0]?.toLowerCase()
    const target = args[1]?.toLowerCase()

    if (action === "enable" || action === "on") {
      await AntiRaid.findOneAndUpdate({ guildId }, { $set: { "honeypot.enabled": true } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Honeypot activé", "> *Le système piège est maintenant **activé**.*")] })
    }

    if (action === "disable" || action === "off") {
      await AntiRaid.findOneAndUpdate({ guildId }, { $set: { "honeypot.enabled": false } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("power", "Honeypot désactivé", "> *Le système piège est maintenant **désactivé**.*")] })
    }

    if (action === "add" && target === "channel") {
      const channel = message.mentions.channels.first()
      const id = channel?.id ?? args[2]
      if (!id) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un salon : `honeypot add channel <#salon>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId }, { $addToSet: { "honeypot.channels": id } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Salon piège ajouté", `> *<#${id}> est maintenant un **salon piège**.*`)] })
    }

    if (action === "add" && target === "role") {
      const role = message.mentions.roles.first()
      const id = role?.id ?? args[2]
      if (!id) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un rôle : `honeypot add role <@rôle>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId }, { $addToSet: { "honeypot.roles": id } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Rôle piège ajouté", `> *<@&${id}> est maintenant un **rôle piège**.*`)] })
    }

    if (action === "remove" && target === "channel") {
      const channel = message.mentions.channels.first()
      const id = channel?.id ?? args[2]
      if (!id) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un salon : `honeypot remove channel <#salon>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId }, { $pull: { "honeypot.channels": id } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Salon piège retiré", "> *Ce salon n'est plus un piège.*")] })
    }

    if (action === "remove" && target === "role") {
      const role = message.mentions.roles.first()
      const id = role?.id ?? args[2]
      if (!id) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un rôle : `honeypot remove role <@rôle>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId }, { $pull: { "honeypot.roles": id } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Rôle piège retiré", "> *Ce rôle n'est plus un piège.*")] })
    }

    if (action === "action" || action === "punish") {
      const punishment = args[1]?.toLowerCase() as Punishment
      if (!PUNISHMENTS.includes(punishment)) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", `> *Punition inconnue. Punitions disponibles : ${PUNISHMENTS.map((p) => `\`${p}\``).join(", ")}.*`)],
        })
      }
      const config = await getConfig(guildId)
      let duration = config.honeypot.duration
      if (punishment === "timeout" && duration <= 0) duration = 600000
      if (punishment !== "timeout") duration = 0
      await AntiRaid.findOneAndUpdate({ guildId }, { $set: { "honeypot.punishment": punishment, "honeypot.duration": duration } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Punition honeypot", `> *Les intrus seront sanctionnés : **${PUNISHMENT_LABELS[punishment]}**.*`)] })
    }

    const config = await getConfig(guildId)
    return message.reply({ components: buildHoneypotContainer(client, message.guild as Guild, config), flags: MessageFlags.IsComponentsV2 })
  },
  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleHoneypotInteraction(client, interaction)
  },
}
