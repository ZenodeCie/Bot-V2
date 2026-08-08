import type { Client, Message } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import formatTime from "../../utils/formatTime.js"
import parseTime from "../../utils/parseTime.js"
import { getConfig } from "../../utils/antiraid/schema.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"

export default {
  name: "raidmode",
  description: "Verrouille ou déverrouille le serveur (mode raid).",
  category: "antiraid",
  aliases: ["lockdown", "raid"],
  permissions: ["Administrator"],
  usage: "[on|off] [durée]",
  async execute(client: Client, message: Message, args: string[]) {
    console.log(`Command ${client.prefix}raidmode used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`)

    if (!message.guild) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }

    const config = await getConfig(message.guild.id)
    const action = args[0]?.toLowerCase()

    if (action === "on") {
      const duration = args[1] ? parseTime(args[1]) : null
      if (args[1] && duration === null) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", "> *Durée invalide. Exemples : `30m`, `1h`, `6h`.*")],
        })
      }
      await client.antiraid.activateRaidMode(client, config, duration ?? config.raidDuration)
      return message.reply({
        embeds: [
          buildAntiRaidEmbed(
            "✅",
            "Mode raid activé",
            `> *Le serveur est verrouillé pour \`${formatTime(duration ?? config.raidDuration)}\`.*`,
            colors.orng
          ),
        ],
      })
    }

    if (action === "off") {
      await client.antiraid.deactivateRaidMode(client, config)
      return message.reply({
        embeds: [buildAntiRaidEmbed("✅", "Mode raid désactivé", "> *Le verrouillage du serveur a été levé.*", colors.yel)],
      })
    }

    const active = config.raidMode && Date.now() < config.raidEndsAt
    return message.reply({
      embeds: [
        buildAntiRaidEmbed(
          "🔒",
          "Mode raid",
          active
            ? `> ***État:** Actif (jusqu'à <t:${Math.floor(config.raidEndsAt / 1000)}:T>)*\n> *Utilisez \`raidmode off\` pour lever le verrouillage.*`
            : "> ***État:** Inactif*\n> *Utilisez \`raidmode on [durée]\` pour verrouiller le serveur.*"
        ),
      ],
    })
  },
}
