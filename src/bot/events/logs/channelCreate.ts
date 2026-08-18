import type { Client, GuildChannel } from "discord.js"
import { handleChannelCreate } from "../../utils/logs/engine.js"

export default {
  name: "channelCreate",
  async execute(client: Client, channel: GuildChannel) {
    await handleChannelCreate(client, channel)
  },
}
