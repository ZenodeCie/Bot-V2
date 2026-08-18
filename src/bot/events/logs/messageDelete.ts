import type { Client, Message, PartialMessage } from "discord.js"
import { handleMessageDelete } from "../../utils/logs/engine.js"

export default {
  name: "messageDelete",
  async execute(client: Client, message: Message | PartialMessage) {
    await handleMessageDelete(client, message)
  },
}
