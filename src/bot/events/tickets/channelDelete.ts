import type { Client, DMChannel, GuildChannel, ThreadChannel } from "discord.js"
import { handleTicketChannelDeleted } from "../../utils/tickets/engine.js"

export default {
  name: "channelDelete",
  async execute(client: Client, channel: GuildChannel | ThreadChannel | DMChannel) {
    if (channel.isDMBased()) return
    await handleTicketChannelDeleted(client, channel).catch((error: unknown) => {
      console.error(`Tickets channelDelete cleanup failed (${channel.id}):`, error)
    })
  },
}