import type { Client, Invite } from "discord.js"
import { handleInviteCreate } from "../../utils/logs/engine.js"

export default {
  name: "inviteCreate",
  async execute(client: Client, invite: Invite) {
    await handleInviteCreate(client, invite)
  },
}
