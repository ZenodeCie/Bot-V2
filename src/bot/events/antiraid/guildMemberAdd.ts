import type { Client, GuildMember } from "discord.js"

export default {
  name: "guildMemberAdd",
  async execute(client: Client, member: GuildMember) {
    await client.antiraid.handleMemberJoin(client, member)
    await client.antiraid.handleHoneypotMemberUpdate(client, member)
  },
}
