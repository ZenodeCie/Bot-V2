import type { Client, Message } from "discord.js"

export default {
  name: "messageDelete",
  async execute(client: Client, message: Message) {
    await client.reactionroles.handleMessageDeleted(message.id).catch(() => undefined)
  },
}