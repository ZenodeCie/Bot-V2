import type { Client, GuildMember } from "discord.js"
import { startChallenge } from "../../utils/captcha/engine.js"

export default {
  name: "guildMemberAdd",
  async execute(client: Client, member: GuildMember) {
    await startChallenge(client, member)
  },
}
