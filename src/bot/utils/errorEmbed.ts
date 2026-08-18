import { EmbedBuilder } from "discord.js";
import { colors } from "../config.js";

export default function buildErrorEmbed(title: string, desc: string) {
  const error = new EmbedBuilder()
    .setTitle(" ")
    .setDescription(
      `# \`❌\` 〃 ${title}\n` + `${desc}`
    )
    .setColor(colors.red)

  return error
}
