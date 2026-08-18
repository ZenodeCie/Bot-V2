import type { Client, GuildEmoji } from "discord.js"
import { handleEmojiUpdate } from "../../utils/logs/engine.js"

export default {
  name: "emojiUpdate",
  async execute(client: Client, oldEmoji: GuildEmoji, newEmoji: GuildEmoji) {
    await handleEmojiUpdate(client, oldEmoji, newEmoji)
  },
}
