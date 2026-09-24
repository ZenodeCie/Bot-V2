import type { Client, Guild } from "discord.js"

export default {
  name: "guildDelete",
  async execute(client: Client, guild: Guild) {
    await client.reactionroles.handleGuildDeleted(guild.id).catch(() => undefined)
  },
}