import type { Client, Invite } from "discord.js"
import { handleInviteDelete } from "../../utils/invitations/engine.js"

export default {
  name: "inviteDelete",
  async execute(client: Client, invite: Invite) {
    await handleInviteDelete(client, invite)
  },
}
