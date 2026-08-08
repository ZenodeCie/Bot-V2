import type { Client, Role } from "discord.js"

export default {
  name: "roleCreate",
  async execute(client: Client, role: Role) {
    await client.antiraid.handleDestructive(client, role.guild, null, "roleCreate", role.id)
  },
}
