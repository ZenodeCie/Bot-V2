import type { Client, GuildMember } from "discord.js"
import { handleMemberJoin } from "../../utils/invitations/engine.js"

export default {
  name: "guildMemberAdd",
  async execute(client: Client, member: GuildMember) {
    await handleMemberJoin(client, member)
  },
}
