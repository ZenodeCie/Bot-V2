import type { Client, Guild, Interaction, Message } from "discord.js"
import { MessageFlags } from "discord.js"
import { getConfig, type AntiRaidConfig } from "../../utils/antiraid/schema.js"
import { buildHubContainer, handleDashboardInteraction } from "../../utils/antiraid/dashboard.js"
import { routeAntiraid } from "../../utils/antiraid/commands.js"

export default {
  name: "antiraid",
  description: "Configure la protection anti-raid du serveur.",
  category: "antiraid",
  aliases: ["anti-raid", "protection", "ar"],
  permissions: ["Administrator"],
  usage: "[sous-commande]",
  async execute(client: Client, message: Message, args: string[]) {
    console.log(`Command antiraid used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`)

    if (!message.guild) {
      return message.reply({
        embeds: [
          {
            title: " ",
            description: "# `🛡️` 〃 Erreur\n> *Cette commande doit être exécutée dans un serveur.*",
            color: 0xe82c20,
          },
        ],
      })
    }

    const config: AntiRaidConfig = await getConfig(message.guild.id)

    if (!args[0]) {
      return message.reply({ components: buildHubContainer(client, message.guild as Guild, config), flags: MessageFlags.IsComponentsV2 })
    }

    return routeAntiraid(client, message, args, config)
  },
  async handleInteraction(client: Client, interaction: Interaction): Promise<boolean> {
    return handleDashboardInteraction(client, interaction)
  },
}
