import type { Client, Message } from "discord.js"

export default {
  name: "messageCreate",
  async execute(client: Client, message: Message) {
    await client.antiraid.handleMessage(client, message)
  },
}
