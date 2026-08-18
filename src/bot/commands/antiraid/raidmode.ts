import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, MessageFlags } from "discord.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import formatTime from "../../utils/formatTime.js"
import parseTime from "../../utils/parseTime.js"
import { getConfig } from "../../utils/antiraid/schema.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { buildLockdownContainer, handleLockdownInteraction } from "../../utils/antiraid/dashboard.js"

export default {
  name: "raidmode",
  description: "Verrouille ou déverrouille le serveur (mode raid).",
  category: "antiraid",
  aliases: ["lockdown", "raid"],
  permissions: ["Administrator"],
  usage: "[on|off] [durée]",
  slash: [
    {
      name: "action",
      description: "on ou off",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "on", value: "on" },
        { name: "off", value: "off" },
      ],
    },
    { name: "duree", description: "Durée (30m, 1h…)", type: ApplicationCommandOptionType.String, required: false },
  ],
  async execute(client: Client, message: Message, args: string[]) {
    console.log(`Command raidmode used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`)

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

    return message.reply({ components: buildLockdownContainer(client, message.guild as Guild, config), flags: MessageFlags.IsComponentsV2 })
  },
  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleLockdownInteraction(client, interaction)
  },
}
