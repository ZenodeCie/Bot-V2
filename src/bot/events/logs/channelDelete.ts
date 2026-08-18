import type { Client, DMChannel, GuildChannel, ThreadChannel } from "discord.js"
import { handleChannelDelete } from "../../utils/logs/engine.js"

export default {
  name: "channelDelete",
  async execute(client: Client, channel: GuildChannel | ThreadChannel | DMChannel) {
    if (channel.isDMBased()) return
    await handleChannelDelete(client, channel)
  },
}
