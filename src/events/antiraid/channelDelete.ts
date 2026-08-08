import type { Channel, Client } from "discord.js"

export default {
  name: "channelDelete",
  async execute(client: Client, channel: Channel) {
    if (!("guild" in channel) || !channel.guild) return
    client.antiraid.snapshotChannel(channel)
    await client.antiraid.handleDestructive(client, channel.guild, null, "channelDelete", channel.id)
  },
}
