import type { Client, GuildEmoji } from "discord.js"
import { handleEmojiDelete } from "../../utils/logs/engine.js"

export default {
  name: "emojiDelete",
  async execute(client: Client, emoji: GuildEmoji) {
    await handleEmojiDelete(client, emoji)
  },
}
