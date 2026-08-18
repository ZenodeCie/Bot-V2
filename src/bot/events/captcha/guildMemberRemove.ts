import type { Client, GuildMember, PartialGuildMember } from "discord.js"
import { handleMemberLeave } from "../../utils/captcha/engine.js"

export default {
  name: "guildMemberRemove",
  async execute(_client: Client, member: GuildMember | PartialGuildMember) {
    await handleMemberLeave(member)
  },
}
