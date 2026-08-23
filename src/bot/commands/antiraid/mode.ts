import type { Client, Guild, Message } from "discord.js"
import { ApplicationCommandOptionType, MessageFlags } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildAntiRaidEmbed } from "../../utils/antiraid/logs.js"
import { buildModeContainer, handleModeInteraction } from "../../utils/antiraid/dashboard.js"
import { MODE_LABELS, MODES, getConfig, type AntiRaidMode } from "../../utils/antiraid/schema.js"

export default {
  name: "mode",
  description: "Configure le mode automatique de la protection anti-raid.",
  category: "antiraid",
  slashRegister: false,
  aliases: ["antiraidmode"],
  permissions: ["Administrator"],
  usage: "[off|low|balanced|high|maximum|custom]",
  slash: [
    {
      name: "mode",
      description: "Mode anti-raid",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "off", value: "off" },
        { name: "low", value: "low" },
        { name: "balanced", value: "balanced" },
        { name: "high", value: "high" },
        { name: "maximum", value: "maximum" },
        { name: "custom", value: "custom" },
      ],
    },
  ],
  async execute(client: Client, message: Message, args: string[]) {
    console.log(`Command mode used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`)

    if (!message.guild) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")] })
    }

    const value = args[0]?.toLowerCase() as AntiRaidMode
    if (value) {
      if (!MODES.includes(value)) {
        return message.reply({
          embeds: [buildErrorEmbed("400 Bad Request", `> *Mode inconnu. Modes disponibles : \`${MODES.join("`, `")}\`.*`)],
        })
      }
      await client.antiraid.applyMode(client, message.guild.id, value)
      return message.reply({
        embeds: [buildAntiRaidEmbed("cog", "Mode mis à jour", `> *Le mode \`${MODE_LABELS[value]}\` a été appliqué (seuils automatiques, réglages custom conservés).*`)],
      })
    }

    const config = await getConfig(message.guild.id)
    return message.reply({ components: buildModeContainer(client, message.guild as Guild, config), flags: MessageFlags.IsComponentsV2 })
  },
  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handleModeInteraction(client, interaction)
  },
}
