import type { Client, Interaction, Message } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { handleConfigHubInteraction, sendConfigHub } from "../../utils/configHub/hub.js"

export default {
  name: "config",
  description: "Configure tous les modules du bot depuis un panneau central.",
  category: "utils",
  aliases: ["configuration", "setup", "settings"],
  permissions: ["Administrator"],
  usage: "[module]",
  async execute(client: Client, message: Message, args: string[]) {
    if (!message.guild) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }

    const directModule = args[0]
    await sendConfigHub(client, message.guild, (payload) => message.reply(payload), directModule)
  },
  async handleInteraction(client: Client, interaction: Interaction): Promise<boolean> {
    return handleConfigHubInteraction(client, interaction)
  },
}
