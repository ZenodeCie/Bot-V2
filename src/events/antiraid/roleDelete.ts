import type { Client, Role } from "discord.js"

export default {
  name: "roleDelete",
  async execute(client: Client, role: Role) {
    client.antiraid.snapshotRole(role)
    await client.antiraid.handleDestructive(client, role.guild, null, "roleDelete", role.id)
  },
}
