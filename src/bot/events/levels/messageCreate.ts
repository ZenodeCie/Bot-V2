import type { Client, Message } from "discord.js"
import { handleMessageXp } from "../../utils/levels/engine.js"

export default {
  name: "messageCreate",
  async execute(client: Client, message: Message) {
    await handleMessageXp(client, message)
  },
}
