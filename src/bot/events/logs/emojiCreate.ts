import type { Client, GuildEmoji } from "discord.js"
import { handleEmojiCreate } from "../../utils/logs/engine.js"

export default {
  name: "emojiCreate",
  async execute(client: Client, emoji: GuildEmoji) {
    await handleEmojiCreate(client, emoji)
  },
}
