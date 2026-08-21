import type { Client, Guild } from "discord.js"
import { cacheGuild } from "../../utils/invitations/engine.js"

export default {
  name: "guildCreate",
  async execute(_client: Client, guild: Guild) {
    await cacheGuild(guild)
  },
}
