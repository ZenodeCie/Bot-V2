import type { Channel, Client } from "discord.js"

export default {
  name: "channelCreate",
  async execute(client: Client, channel: Channel) {
    if (!("guild" in channel) || !channel.guild) return
    await client.antiraid.handleDestructive(client, channel.guild, null, "channelCreate", channel.id)
  },
}
