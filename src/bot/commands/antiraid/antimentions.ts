import { createModuleCommand } from "./moduleFactory.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { AntiRaid } from "../../utils/antiraid/schema.js"

export default createModuleCommand({
  name: "antimentions",
  description: "Configure la protection anti-mention.",
  module: "mentions",
  aliases: ["mentions", "antimentions"],
  usage: "[on|off|threshold <n>|interval <durée>|action <punition>|maxuser <n>|maxrole <n>|everyone <on|off>]",
  textActions: {
    async maxuser(_client, message, args) {
      const count = Number(args[1])
      if (!Number.isInteger(count) || count < 1) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antimentions maxuser <nombre>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { "modules.mentions.maxUserMentions": count, mode: "custom" } }, { upsert: true })
      _client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Mentions", `> ***Max mentions utilisateur par message:** \`${count}\`.*`)] })
    },
    async maxrole(_client, message, args) {
      const count = Number(args[1])
      if (!Number.isInteger(count) || count < 1) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antimentions maxrole <nombre>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { "modules.mentions.maxRoleMentions": count, mode: "custom" } }, { upsert: true })
      _client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Mentions", `> ***Max mentions rôle par message:** \`${count}\`.*`)] })
    },
    async everyone(_client, message, args) {
      const value = args[1]?.toLowerCase()
      if (value !== "on" && value !== "off") {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antimentions everyone <on|off>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { "modules.mentions.allowEveryone": value === "on", mode: "custom" } }, { upsert: true })
      _client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Mentions", `> *Mention @everyone/@here : ${value === "on" ? "autorisée ✅" : "bloquée ❌"}.*`)] })
    },
  },
})
