import type { Client, GuildMember, PartialGuildMember } from "discord.js"
import { handleMemberRemove } from "../../utils/logs/engine.js"

export default {
  name: "guildMemberRemove",
  async execute(client: Client, member: GuildMember | PartialGuildMember) {
    await handleMemberRemove(client, member)
  },
}
