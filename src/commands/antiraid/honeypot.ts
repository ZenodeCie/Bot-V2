import type { Client, Guild, Message } from "discord.js"
import { MessageFlags } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { buildHoneypotContainer, handleHoneypotInteraction } from "../../utils/antiraid/dashboard.js"
import { AntiRaid, PUNISHMENT_LABELS, PUNISHMENTS, getConfig, type Punishment } from "../../utils/antiraid/schema.js"

export default {
  name: "honeypot",
  description: "Configure le système piège (honeypot) anti-intrus.",
  category: "antiraid",
  aliases: ["hp"],
  permissions: ["Administrator"],
  usage: "[enable|disable|add channel <#salon>|remove channel <#salon>|add role <@rôle>|remove role <@rôle>|action <punition>]",
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
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Honeypot activé", "> *Le système piège est maintenant **activé**.*")] })
    }

    if (action === "disable" || action === "off") {
      await AntiRaid.findOneAndUpdate({ guildId }, { $set: { "honeypot.enabled": false } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("⏹️", "Honeypot désactivé", "> *Le système piège est maintenant **désactivé**.*")] })
    }

    if (action === "add" && target === "channel") {
      const channel = message.mentions.channels.first()
      if (!channel) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un salon : `honeypot add channel <#salon>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId }, { $addToSet: { "honeypot.channels": channel.id } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Salon piège ajouté", `> *<#${channel.id}> est maintenant un **salon piège**.*`)] })
    }

    if (action === "add" && target === "role") {
      const role = message.mentions.roles.first()
      if (!role) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un rôle : `honeypot add role <@rôle>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId }, { $addToSet: { "honeypot.roles": role.id } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Rôle piège ajouté", `> *<@&${role.id}> est maintenant un **rôle piège**.*`)] })
    }

    if (action === "remove" && target === "channel") {
      const channel = message.mentions.channels.first()
      const id = channel?.id ?? args[2]
      if (!id) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un salon : `honeypot remove channel <#salon>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId }, { $pull: { "honeypot.channels": id } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Salon piège retiré", "> *Ce salon n'est plus un piège.*")] })
    }

    if (action === "remove" && target === "role") {
      const role = message.mentions.roles.first()
      const id = role?.id ?? args[2]
      if (!id) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un rôle : `honeypot remove role <@rôle>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId }, { $pull: { "honeypot.roles": id } }, { upsert: true })
      client.antiraid.invalidateConfig(guildId)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Rôle piège retiré", "> *Ce rôle n'est plus un piège.*")] })
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
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Punition honeypot", `> *Les intrus seront sanctionnés : **${PUNISHMENT_LABELS[punishment]}**.*`)] })
    }

    const config = await getConfig(guildId)
    return message.reply({ components: buildHoneypotContainer(client, message.guild as Guild, config), flags: MessageFlags.IsComponentsV2 })
  },
  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleHoneypotInteraction(client, interaction)
  },
}
