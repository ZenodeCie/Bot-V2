import type { Client, ThreadChannel } from "discord.js"
import { handleThreadUpdate } from "../../utils/logs/engine.js"

export default {
  name: "threadUpdate",
  async execute(client: Client, oldThread: ThreadChannel, newThread: ThreadChannel) {
    await handleThreadUpdate(client, oldThread, newThread)
  },
}
