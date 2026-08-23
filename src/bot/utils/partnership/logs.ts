import { EmbedBuilder, type Client, type ColorResolvable } from "discord.js"
import { colors } from "../../config.js"
import { appEmojiHeading, type AppEmojiName } from "../appEmojis.js"

export function buildPartnershipEmbed(
  name: AppEmojiName,
  title: string,
  desc: string,
  color: `#${string}` | null = colors.prime
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(" ").setDescription(`${appEmojiHeading(name, title)}\n${desc}`)
  if (color) embed.setColor(color as ColorResolvable)
  return embed
}

export async function sendToChannel(client: Client, channelId: string | null, embed: EmbedBuilder, extra: Record<string, unknown> = {}): Promise<string | null> {
  try {
    if (!channelId) return null
    const channel = client.channels.cache.get(channelId)
    if (!channel) return null
    if (!channel.isTextBased() || !channel.isSendable()) return null
    const sent = await channel.send({ embeds: [embed], ...extra })
    return sent.id
  } catch (error) {
    console.error(`Failed to send partnership message to channel ${channelId}:`, error)
    return null
  }
}
