import type { Client, Collection, Message, PartialMessage, Snowflake, TextBasedChannel } from "discord.js"
import { handleMessageDeleteBulk } from "../../utils/logs/engine.js"

export default {
  name: "messageDeleteBulk",
  async execute(
    client: Client,
    messages: Collection<Snowflake, Message | PartialMessage>,
    channel: TextBasedChannel
  ) {
    await handleMessageDeleteBulk(client, messages, channel)
  },
}
