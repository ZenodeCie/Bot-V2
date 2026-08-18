import type { Client, GuildBan } from "discord.js"
import { handleBanRemove } from "../../utils/logs/engine.js"

export default {
  name: "guildBanRemove",
  async execute(client: Client, ban: GuildBan) {
    await handleBanRemove(client, ban)
  },
}
