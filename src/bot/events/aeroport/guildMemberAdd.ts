import type { Client, GuildMember } from "discord.js"
import { handleMemberJoin } from "../../utils/aeroport/messages.js"

export default {
  name: "guildMemberAdd",
  async execute(client: Client, member: GuildMember) {
    await handleMemberJoin(client, member)
  },
}
