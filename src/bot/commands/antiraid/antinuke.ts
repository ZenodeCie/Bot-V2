import { createModuleCommand } from "./moduleFactory.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { AntiRaid } from "../../utils/antiraid/schema.js"

export default createModuleCommand({
  name: "antinuke",
  description: "Configure la protection anti-nuke (suppressions destructives).",
  module: "nuke",
  aliases: ["nuke", "antinuke"],
  usage: "[on|off|threshold <n>|interval <durée>|action <punition>|channel <n>|role <n>|webhook <n>]",
  textActions: {
    async channel(_client, message, args) {
      const count = Number(args[1])
      if (!Number.isInteger(count) || count < 1) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antinuke channel <nombre>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { "modules.nuke.channelThreshold": count, mode: "custom" } }, { upsert: true })
      _client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Anti-nuke", `> ***Suppressions de salons :** seuil \`${count}\`.*`)] })
    },
    async role(_client, message, args) {
      const count = Number(args[1])
      if (!Number.isInteger(count) || count < 1) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antinuke role <nombre>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { "modules.nuke.roleThreshold": count, mode: "custom" } }, { upsert: true })
      _client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Anti-nuke", `> ***Suppressions de rôles :** seuil \`${count}\`.*`)] })
    },
    async webhook(_client, message, args) {
      const count = Number(args[1])
      if (!Number.isInteger(count) || count < 1) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antinuke webhook <nombre>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { "modules.nuke.webhookThreshold": count, mode: "custom" } }, { upsert: true })
      _client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Anti-nuke", `> ***Créations de webhooks :** seuil \`${count}\`.*`)] })
    },
  },
})
