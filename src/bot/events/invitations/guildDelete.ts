import type { Client, Guild } from "discord.js"
import { dropGuildCache } from "../../utils/invitations/engine.js"

export default {
  name: "guildDelete",
  async execute(_client: Client, guild: Guild) {
    dropGuildCache(guild.id)
  },
}
