import type { Client, Role } from "discord.js"

export default {
  name: "roleDelete",
  async execute(client: Client, role: Role) {
    await client.reactionroles.handleRoleDeleted(role.guild.id, role.id).catch(() => undefined)
  },
}