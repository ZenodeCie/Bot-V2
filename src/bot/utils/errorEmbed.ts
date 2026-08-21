import { EmbedBuilder } from "discord.js"
import { colors } from "../config.js"
import { appEmojiHeading } from "./appEmojis.js"

export default function buildErrorEmbed(title: string, desc: string) {
  const error = new EmbedBuilder()
    .setTitle(" ")
    .setDescription(`${appEmojiHeading("cancel", title)}\n${desc}`)
    .setColor(colors.red)

  return error
}
