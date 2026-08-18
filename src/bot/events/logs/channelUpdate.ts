import type { Client, DMChannel, GuildChannel } from "discord.js"
import { handleChannelUpdate } from "../../utils/logs/engine.js"

export default {
  name: "channelUpdate",
  async execute(client: Client, oldChannel: DMChannel | GuildChannel, newChannel: DMChannel | GuildChannel) {
    if (oldChannel.isDMBased() || newChannel.isDMBased()) return
    await handleChannelUpdate(client, oldChannel, newChannel)
  },
}
