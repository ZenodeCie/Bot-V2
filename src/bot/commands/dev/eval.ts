import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType, EmbedBuilder } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import config from "../../config.js"
import util from "node:util"

export default {
  name: "eval",
  description: "Évalue du code JavaScript. [OWNER]",
  category: "dev",
  aliases: ["e", "evaluate", "js"],
  permissions: [],
  usage: "<code>",
  slash: [
    { name: "code", description: "Code JavaScript à évaluer", type: ApplicationCommandOptionType.String, required: true },
  ],

  async execute(_client: Client, _message: Message, args: string[] = []) {
    if (!config.ownerId.includes(_message.author.id)) {
      return
    }

    console.log(
      `\x1b[1;31mCommand eval used by ${_message.author.tag} (${_message.author.id}) in the guild ${_message.guild?.name} (${_message.guild?.id}${_message.guild?.vanityURLCode ? ` / .gg/${_message.guild?.vanityURLCode}` : ""})\x1b[0m`
    )

    const code = args.length ? args.join(" ") : _message.content.split(" ").slice(1).join(" ")

    if (!code) {
      return _message.reply("Veuillez fournir du code à évaluer.")
    }

    const output: string[] = []

    const evalConsole = {
      log: (...values: unknown[]) => {
        console.log(...values)
        output.push(util.format(...values))
      },

      info: (...values: unknown[]) => {
        console.info(...values)
        output.push(util.format(...values))
      },

      warn: (...values: unknown[]) => {
        console.warn(...values)
        output.push(util.format(...values))
      },

      error: (...values: unknown[]) => {
        console.error(...values)
        output.push(util.format(...values))
      },

      debug: (...values: unknown[]) => {
        console.debug(...values)
        output.push(util.format(...values))
      }
    }

    try {
      const result = await eval(
        `(async (console, _message) => { ${code} })(evalConsole, _message)`
      )

      if (output.length > 0) {
        let message = output.join("\n")

        if (result !== undefined) {
          message += `\n${util.format(result)}`
        }

        if (message.length > 2000) {
          message = message.slice(0, 1997) + "..."
        }

        return _message.reply(message)
      }

      if (result !== undefined) {
        let message = util.format(result)

        if (message.length > 2000) {
          message = message.slice(0, 1997) + "..."
        }

        return _message.reply(message)
      }

      return _message.reply(
        "Code exécuté avec succès, mais aucune valeur de retour."
      )

    } catch (error) {
      console.error(error)

      const errorEmbed = buildErrorEmbed(
        "500 Internal Server Error",
        `\`\`\`ansi\n\x1b[31m${error}\x1b[0m\n\`\`\``
      )

      return _message.reply({ embeds: [errorEmbed] })
    }
  }
}