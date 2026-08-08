import { createModuleCommand } from "./moduleFactory.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { AntiRaid } from "../../utils/antiraid/schema.js"

export default createModuleCommand({
  name: "verifyconfig",
  description: "Configure le module de vérification (rôle attribué après vérif).",
  module: "verify",
  aliases: ["verifyrole", "verifconfig"],
  usage: "[on|off|action <punition>|role <@rôle|off>]",
  textActions: {
    async role(client, message, args) {
      const role = message.mentions.roles.first()
      const raw = args[1]?.toLowerCase()
      const roleId = role ? role.id : raw && raw !== "off" && raw !== "none" ? args[1] : null
      if (!roleId && raw !== "off" && raw !== "none") {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Mentionnez un rôle ou utilisez `verifyconfig role off`.*")],
        })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { "modules.verify.role": roleId, mode: "custom" } }, { upsert: true })
      client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({
        embeds: [
          buildAntiRaidEmbed(
            "✅",
            "Rôle de vérification mis à jour",
            roleId ? `> *Le rôle **<@&${roleId}>** sera attribué après vérification.*` : "> *Aucun rôle ne sera attribué après vérification.*"
          ),
        ],
      })
    },
  },
})
