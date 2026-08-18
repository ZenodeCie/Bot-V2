import type { Client, Message, PartialMessage } from "discord.js"
import { handleMessageUpdate } from "../../utils/logs/engine.js"

export default {
  name: "messageUpdate",
  async execute(client: Client, oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
    await handleMessageUpdate(client, oldMessage, newMessage)
  },
}
