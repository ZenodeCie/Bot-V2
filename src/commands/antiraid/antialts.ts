import { createModuleCommand } from "./moduleFactory.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { AntiRaid } from "../../utils/antiraid/schema.js"

export default createModuleCommand({
  name: "antialts",
  description: "Configure la protection anti-comptes alternatifs (premium).",
  module: "alts",
  aliases: ["alts", "antialt"],
  usage: "[on|off|action <punition>|maxage <jours>]",
  textActions: {
    async maxage(_client, message, args) {
      const days = Number(args[1])
      if (!Number.isInteger(days) || days < 1) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antialts maxage <jours>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { "modules.alts.maxAge": days * 86400000, mode: "custom" } }, { upsert: true })
      _client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({ embeds: [buildAntiRaidEmbed("✅", "Anti-alts", `> ***Âge maximum du compte :** \`${days}\` jour${days > 1 ? "s" : ""}.*`)] })
    },
  },
})
