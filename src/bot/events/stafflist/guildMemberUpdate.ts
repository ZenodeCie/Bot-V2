import type { Client, GuildMember, PartialGuildMember } from "discord.js"
import { handleMemberUpdate } from "../../utils/stafflist/engine.js"

export default {
  name: "guildMemberUpdate",
  async execute(client: Client, oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) {
    await handleMemberUpdate(client, oldMember, newMember)
  },
}
