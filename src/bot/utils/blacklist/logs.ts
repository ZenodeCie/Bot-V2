import { EmbedBuilder, type Client, type ColorResolvable } from "discord.js"
import { colors } from "../../config.js"
import { appEmojiHeading, type AppEmojiName } from "../appEmojis.js"
import { getConfig } from "./schema.js"

export function buildBlacklistEmbed(
  name: AppEmojiName,
  title: string,
  desc: string,
  color: `#${string}` | null = colors.red
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(" ").setDescription(`${appEmojiHeading(name, title)}\n${desc}`)
  if (color) embed.setColor(color as ColorResolvable)
  return embed
}

export async function sendBlacklistLog(client: Client, guildId: string, embed: EmbedBuilder): Promise<void> {
  try {
    const config = await getConfig(guildId)
    if (!config.logChannel) return
    const channel = client.channels.cache.get(config.logChannel)
    if (!channel) return
    if (!channel.isTextBased() || !channel.isSendable()) return
    await channel.send({ embeds: [embed] })
  } catch (error) {
    console.error(`Failed to send blacklist log in guild ${guildId}:`, error)
  }
}
