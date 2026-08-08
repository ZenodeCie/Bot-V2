import type { Client, Message } from "discord.js"
import { EmbedBuilder } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import formatTime from "../../utils/formatTime.js"

export default {
  name: "ping",
  description: "Vérifie que le bot répond.",
  category: "utils",
  aliases: ["latency", "bot-latency"],
  permissions: [],
  usage: "",
  async execute(_client: Client, _message: Message) {
    console.log(`Command ping used by ${_message.author.tag} (${_message.author.id}) in the guild ${_message.guild?.name} (${_message.guild?.id}${_message.guild?.vanityURLCode ? ` / .gg/${_message.guild?.vanityURLCode}` : ""})`)

    const sent = await _message.reply("Pinging...")
    const apiping = sent.createdTimestamp - _message.createdTimestamp

    console.log(`The Websocket bot's ping is ${_client.ws.ping}ms and the API latency is ${apiping}ms`)
    console.log(`Uptime: ${formatTime(_client.uptime ?? 0)}`)

    const embed = new EmbedBuilder()
      .setTitle(" ")
      .setDescription(
        `# \`🪄\` 〃 Latency\n` +
        `> ***Websocket:** \`${_client.ws.ping}ms\`*\n` +
        `> ***API:** \`${sent.createdTimestamp - _message.createdTimestamp}ms\`*\n` +
        `> ***Uptime:** \`${formatTime(_client.uptime ?? 0)}\`*`
      )
      .setFooter({ text: _message.author.tag, iconURL: _message.author.displayAvatarURL() })
      .setThumbnail(String(_client.user?.displayAvatarURL()))

    try {
      sent.edit({ embeds: [embed], content: "" })
    } catch (err) {
      sent.edit({ embeds: [buildErrorEmbed("500 Internal Server Error", `> *${err}*`)], content: "" })
    }
  }
}
