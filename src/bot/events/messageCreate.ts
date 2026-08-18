import type { Client, Message } from "discord.js"
import config from "../config.js"
import buildErrorEmbed from "../utils/errorEmbed.js"
import { Guild } from "../utils/initData.js"

export default {
  name: "messageCreate",
  async execute(client: Client, message: Message) {
    if (message.author.bot) return

    let prefix = config.prefix
    if (message.guild) {
      try {
        prefix =
          (await Guild.findOne({ guildId: message.guild.id }).select("prefix").lean())?.prefix ?? config.prefix
      } catch {
        prefix = config.prefix
      }
    }

    if (!message.content.startsWith(prefix)) return

    const args = message.content.slice(prefix.length).trim().split(/ +/)
    const commandName = args.shift()?.toLowerCase()
    if (!commandName) return

    const command =
      client.commands.get(commandName) ??
      client.commands.find((cmd) => cmd.aliases?.includes(commandName))
    if (!command) return

    if (command.permissions?.length) {
      const missing = message.member?.permissions.missing(command.permissions)
      if (missing?.length) {
        return message.reply({
          embeds: [buildErrorEmbed("401 Unauthorized", "> *You are not authorized to execute this command.*")]
        })
      }
    }

    try {
      await command.execute(client, message, args)
    } catch (error) {
      console.error(`Erreur lors de l'exécution de ${commandName}:`, error)
      await message.reply({embeds: [buildErrorEmbed("500 Internal Server Error", "> *An error occurred while executing this command.*\n\`\`\`\n" + error + "\n\`\`\`")]})
    }
  },
}
