import type { Client, ThreadChannel } from "discord.js"
import { handleThreadDelete } from "../../utils/logs/engine.js"

export default {
  name: "threadDelete",
  async execute(client: Client, thread: ThreadChannel) {
    await handleThreadDelete(client, thread)
  },
}
