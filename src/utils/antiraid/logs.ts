import { EmbedBuilder, type Client, type ColorResolvable } from "discord.js"
import { colors } from "../../config.js"
import { getConfig } from "./schema.js"

export function buildAntiRaidEmbed(
  emoji: string,
  title: string,
  desc: string,
  color: `#${string}` | null = colors.red
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(" ")
    .setDescription(`# \`${emoji}\` 〃 ${title}\n${desc}`)
  if (color) embed.setColor(color as ColorResolvable)
  return embed
}

export function buildUserEmbed(emoji: string, title: string, desc: string, color: `#${string}` | null): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(" ")
    .setDescription(`# \`${emoji}\` 〃 ${title}\n${desc}`)
  if (color) embed.setColor(color as ColorResolvable)
  return embed
}

export async function sendLog(client: Client, guildId: string, embed: EmbedBuilder) {
  try {
    const config = await getConfig(guildId)
    if (!config.logChannel) return
    const channel = client.channels.cache.get(config.logChannel)
    if (!channel) return
    if (!channel.isTextBased() || !channel.isSendable()) return
    await channel.send({ embeds: [embed] })
  } catch (error) {
    console.error(`Failed to send anti-raid log in guild ${guildId}:`, error)
  }
}
