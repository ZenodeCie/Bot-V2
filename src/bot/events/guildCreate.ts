import type { Client, Guild } from "discord.js"
import { registerGuildSlashCommands } from "../utils/slash.js"

export default {
  name: "guildCreate",
  async execute(client: Client, guild: Guild) {
    try {
      await registerGuildSlashCommands(client, guild)
    } catch (error) {
      console.error(`Failed to register slash commands on guild ${guild.id}:`, error)
    }
  },
}
