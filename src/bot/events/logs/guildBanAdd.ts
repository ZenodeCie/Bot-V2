import type { Client, GuildBan } from "discord.js"
import { handleBanAdd } from "../../utils/logs/engine.js"

export default {
  name: "guildBanAdd",
  async execute(client: Client, ban: GuildBan) {
    await handleBanAdd(client, ban)
  },
}
