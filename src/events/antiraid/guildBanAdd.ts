import type { Client, GuildBan } from "discord.js"

export default {
  name: "guildBanAdd",
  async execute(client: Client, ban: GuildBan) {
    await client.antiraid.handleDestructive(client, ban.guild, null, "ban", ban.user.id)
  },
}
