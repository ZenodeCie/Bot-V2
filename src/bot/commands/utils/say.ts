import { ApplicationCommandOptionType, MessageFlags, type Client, type Message } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { appEmojiHeading } from "../../utils/appEmojis.js"
import { slashInteractionOf } from "../../utils/slash.js"

export default {
  name: "say",
  description: "Fait envoyer un message par le bot dans le salon courant.",
  category: "utils",
  aliases: [],
  permissions: ["Administrator"],
  usage: "<texte>",
  slash: [
    { name: "texte", description: "Le message à envoyer", type: ApplicationCommandOptionType.String, required: true },
  ],

  async execute(_client: Client, message: Message, args: string[]) {
    console.log(
      `Command say used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
    )

    if (!message.guild) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")] })
    }

    const text = args.join(" ").trim()
    if (!text) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Aucun message fourni. Exemple : `say Bonjour à tous !`.*")] })
    }

    const channel = message.channel
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !channel.isSendable()) {
      return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un salon textuel.*")] })
    }

    try {
      await channel.send({ content: text, allowedMentions: { parse: [] } })
    } catch (error) {
      console.error("Say failed:", error)
      return message.reply({ embeds: [buildErrorEmbed("500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)] })
    }

    const interaction = slashInteractionOf(message)
    if (interaction) {
      return interaction
        .reply({
          embeds: [
            {
              title: " ",
              description: `${appEmojiHeading("check", "Message envoyé")}\n> ***Salon :** <#${channel.id}>`,
              color: 0x2ecc71,
            },
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => undefined)
    }
    return message.delete().catch(() => undefined)
  },
}
