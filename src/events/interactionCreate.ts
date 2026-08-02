import type { Client, Interaction } from "discord.js"

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
  },
}
