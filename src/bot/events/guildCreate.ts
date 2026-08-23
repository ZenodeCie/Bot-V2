import type { Client, Guild } from "discord.js"
import { sendGuildOnboarding } from "../utils/configHub/onboarding.js"
import { registerGuildSlashCommands } from "../utils/slash.js"

export default {
  name: "guildCreate",
  async execute(client: Client, guild: Guild) {
    try {
      await registerGuildSlashCommands(client, guild)
    } catch (error) {
      console.error(`Failed to register slash commands on guild ${guild.id}:`, error)
    }

    try {
      await sendGuildOnboarding(client, guild)
    } catch (error) {
      console.error(`Failed to send onboarding for guild ${guild.id}:`, error)
    }
  },
}
