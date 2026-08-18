import type { Client, ThreadChannel } from "discord.js"
import { handleThreadCreate } from "../../utils/logs/engine.js"

export default {
  name: "threadCreate",
  async execute(client: Client, thread: ThreadChannel) {
    await handleThreadCreate(client, thread)
  },
}
