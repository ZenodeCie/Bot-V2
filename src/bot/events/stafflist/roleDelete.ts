import type { Client, Role } from "discord.js"
import { handleRoleDelete } from "../../utils/stafflist/engine.js"

export default {
  name: "roleDelete",
  async execute(client: Client, role: Role) {
    await handleRoleDelete(client, role)
  },
}
