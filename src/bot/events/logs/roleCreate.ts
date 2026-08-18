import type { Client, Role } from "discord.js"
import { handleRoleCreate } from "../../utils/logs/engine.js"

export default {
  name: "roleCreate",
  async execute(client: Client, role: Role) {
    await handleRoleCreate(client, role)
  },
}
