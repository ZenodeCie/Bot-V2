import type { Client, GuildMember } from "discord.js"
import { recordUsername } from "../../utils/usernameHistory.js"

export default {
  name: "guildMemberUpdate",
  async execute(_client: Client, oldMember: GuildMember, newMember: GuildMember) {
    try {
      if (oldMember.nickname !== newMember.nickname && oldMember.nickname) {
        await recordUsername(newMember.guild.id, newMember.id, oldMember.nickname, "nickname")
      }
    } catch (error) {
      console.error("Failed to record nickname change:", error)
    }
  },
}