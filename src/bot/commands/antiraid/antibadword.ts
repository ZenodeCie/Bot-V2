import { createModuleCommand } from "./moduleFactory.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { AntiRaid } from "../../utils/antiraid/schema.js"

export default createModuleCommand({
  name: "antibadword",
  description: "Configure la liste des mots interdits.",
  module: "badword",
  aliases: ["badword", "motsinterdits", "antibadwords"],
  usage: "[on|off|action <punition>|add <mot>|remove <mot>|list]",
  textActions: {
    async add(_client, message, args) {
      const word = args.slice(1).join(" ").toLowerCase()
      if (!word) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antibadword add <mot>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $addToSet: { "modules.badword.bannedWords": word } }, { upsert: true })
      _client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Mot interdit", `> *\`${word}\` a été ajouté à la liste des mots interdits.*`)] })
    },
    async remove(_client, message, args) {
      const word = args.slice(1).join(" ").toLowerCase()
      if (!word) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antibadword remove <mot>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $pull: { "modules.badword.bannedWords": word } }, { upsert: true })
      _client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Mot interdit", `> *\`${word}\` a été retiré de la liste des mots interdits.*`)] })
    },
    async list(_client, message, _args, config) {
      const words = config.modules.badword.bannedWords
      return message.reply({
        embeds: [
          buildAntiRaidEmbed(
            "cancel",
            "Mots interdits",
            words.length > 0
              ? `> *Liste (${words.length}) :*\n> ${words.map((w) => `\`${w}\``).join(", ")}`
              : "> *Aucun mot interdit.*"
          ),
        ],
      })
    },
  },
})
