import { createModuleCommand } from "./moduleFactory.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { AntiRaid } from "../../utils/antiraid/schema.js"
import { appEmojiText } from "../../utils/appEmojis.js"

function cleanDomain(raw: string): string {
  return raw.toLowerCase().replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
}

export default createModuleCommand({
  name: "antilinks",
  description: "Configure la protection anti-lien et le blocage des invitations.",
  module: "links",
  aliases: ["links", "antilink", "antilinks"],
  usage: "[on|off|threshold <n>|interval <durée>|action <punition>|allow <domaine>|block <domaine>|invites <on|off>|list]",
  textActions: {
    async allow(_client, message, args) {
      const domain = args[1]?.toLowerCase()
      if (!domain) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antilinks allow <domaine>`.*")] })
      }
      const clean = cleanDomain(domain)
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $addToSet: { "modules.links.allowedDomains": clean } }, { upsert: true })
      _client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Domaines autorisés", `> *\`${clean}\` ajouté à la liste blanche des domaines.*`)] })
    },
    async block(_client, message, args) {
      const domain = args[1]?.toLowerCase()
      if (!domain) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antilinks block <domaine>`.*")] })
      }
      const clean = cleanDomain(domain)
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $addToSet: { "modules.links.blockedDomains": clean } }, { upsert: true })
      _client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Domaines bloqués", `> *\`${clean}\` ajouté à la liste noire des domaines.*`)] })
    },
    async invites(_client, message, args) {
      const value = args[1]?.toLowerCase()
      if (value !== "on" && value !== "off") {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Utilisation : `antilinks invites <on|off>`.*")] })
      }
      await AntiRaid.findOneAndUpdate({ guildId: message.guild!.id }, { $set: { "modules.links.blockDiscordInvites": value === "on", mode: "custom" } }, { upsert: true })
      _client.antiraid.invalidateConfig(message.guild!.id)
      return message.reply({ embeds: [buildAntiRaidEmbed("check", "Liens", `> *Blocage des invitations Discord : ${value === "on" ? `activé ${appEmojiText("check")}` : `désactivé ${appEmojiText("cancel")}`}.*`)] })
    },
    async list(_client, message, _args, config) {
      const allowed = config.modules.links.allowedDomains
      const blocked = config.modules.links.blockedDomains
      return message.reply({
        embeds: [
          buildAntiRaidEmbed(
            "pin",
            "Domaines",
            `### ${appEmojiText("check")} Autorisés (${allowed.length})\n` +
              (allowed.length > 0 ? `> ${allowed.map((d) => `\`${d}\``).join(", ")}` : "> *Aucun*") +
              `\n\n### ${appEmojiText("cancel")} Bloqués (${blocked.length})\n` +
              (blocked.length > 0 ? `> ${blocked.map((d) => `\`${d}\``).join(", ")}` : "> *Aucun*")
          ),
        ],
      })
    },
  },
})
