import type { Client, GuildMember } from "discord.js"

export default {
  name: "guildMemberUpdate",
  async execute(client: Client, oldMember: GuildMember, newMember: GuildMember) {
    const added = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id))
    if (added.size === 0) return
    await client.antiraid.handleHoneypotMemberUpdate(client, newMember)
  },
}
