import type { Channel, Client, GuildChannel } from "discord.js"
import { applyMuteOverwritesToChannel, getMuteRole } from "../../utils/moderation/mute.js"

export default {
  name: "channelCreate",
  async execute(client: Client, channel: GuildChannel) {
    try {
      const role = await getMuteRole(channel.guild)
      if (!role) return
      await applyMuteOverwritesToChannel(channel as unknown as Channel, role)
    } catch (error) {
      console.error("Failed to apply mute role to new channel:", error)
    }
  },
}
