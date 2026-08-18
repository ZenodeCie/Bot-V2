import type { Client, GuildMember, PartialGuildMember } from "discord.js"
import { handleMemberLeave } from "../../utils/aeroport/messages.js"

export default {
  name: "guildMemberRemove",
  async execute(client: Client, member: GuildMember | PartialGuildMember) {
    await handleMemberLeave(client, member)
  },
}
