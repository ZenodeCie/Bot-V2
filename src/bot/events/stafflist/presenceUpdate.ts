import type { Client, Presence } from "discord.js"
import { handlePresenceUpdate } from "../../utils/stafflist/engine.js"

export default {
  name: "presenceUpdate",
  async execute(client: Client, oldPresence: Presence | null, newPresence: Presence) {
    await handlePresenceUpdate(client, oldPresence, newPresence)
  },
}
