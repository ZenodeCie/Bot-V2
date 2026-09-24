import type { Client, GuildChannel } from "discord.js"

export default {
  name: "channelDelete",
  async execute(client: Client, channel: GuildChannel) {
    await client.reactionroles.handleChannelDeleted(channel.guildId, channel.id).catch(() => undefined)
  },
}