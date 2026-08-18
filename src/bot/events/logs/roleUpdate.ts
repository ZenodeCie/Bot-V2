import type { Client, Role } from "discord.js"
import { handleRoleUpdate } from "../../utils/logs/engine.js"

export default {
  name: "roleUpdate",
  async execute(client: Client, oldRole: Role, newRole: Role) {
    await handleRoleUpdate(client, oldRole, newRole)
  },
}
