import { EmbedBuilder, type Client, type Message } from "discord.js"
import { colors } from "../../config.js"
import { appEmojiHeading } from "../../utils/appEmojis.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"

const QUOTES_API = "https://pasfutefute.fr/api/quotes/random"

async function fetchRandomQuote(): Promise<string | null> {
  try {
    const res = await fetch(QUOTES_API, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null
    const data = (await res.json()) as { quote?: unknown }
    const quote = typeof data.quote === "string" ? data.quote.trim() : ""
    return quote || null
  } catch (error) {
    console.error("Failed to fetch pasfutefute quote:", error)
    return null
  }
}

export default {
  name: "pasfutfut",
  description: "Affiche une citation pas fute fute.",
  category: "fun",
  slashName: "pasfutfut",
  aliases: ["pff", "citation"],
  permissions: [],
  usage: "",

  async execute(_client: Client, message: Message) {
    console.log(
      `Command pasfutfut used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
    )

    const quote = await fetchRandomQuote()
    if (!quote) {
      return message.reply({
        embeds: [buildErrorEmbed("503 Service Unavailable", "> *L'API Pas fute fute est injoignable. Réessayez plus tard.*")],
      })
    }

    const embed = new EmbedBuilder()
      .setTitle(" ")
      .setDescription(`${appEmojiHeading("file", "Pas fute fute")}\n> *« ${quote} »*`)
    if (colors.prime) embed.setColor(colors.prime)

    return message.reply({ embeds: [embed] })
  },
}
