import type { Client, Interaction } from "discord.js"
import { MessageFlags } from "discord.js"

export default {
  name: "interactionCreate",
  async execute(client: Client, interaction: Interaction) {
    for (const handler of client.interactions.values()) {
      try {
        if (await handler(client, interaction)) return
      } catch (error) {
        console.error(`Erreur lors du traitement d'une interaction:`, error)
      }
    }
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try {
        if (interaction.isMessageComponent()) {
          await interaction.deferUpdate()
        } else {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        }
      } catch {
        /* fallback best-effort */
      }
    }
  },
}
