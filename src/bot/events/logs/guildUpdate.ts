import type { Client, Guild } from "discord.js"
import { handleGuildUpdate } from "../../utils/logs/engine.js"

export default {
  name: "guildUpdate",
  async execute(client: Client, oldGuild: Guild, newGuild: Guild) {
    await handleGuildUpdate(client, oldGuild, newGuild)
  },
}
