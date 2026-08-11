import { EmbedBuilder, PermissionFlagsBits, type Client, type Message } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"

const ADD_TAG = "<:Add:1469692082107977782>"

const CUSTOM_EMOJI_REGEX = /<a?:\w{2,32}:\d{17,20}>/g

interface CustomEmojiInfo {
  name: string
  id: string
  animated: boolean
  tag: string
  url: string
}

function parseCustomEmoji(tag: string): CustomEmojiInfo {
  const match = /^<(a)?:(\w{2,32}):(\d{17,20})>$/.exec(tag)
  if (!match) throw new Error("Invalid custom emoji tag")
  const animated = Boolean(match[1])
  return {
    name: match[2],
    id: match[3],
    animated,
    tag,
    url: `https://cdn.discordapp.com/emojis/${match[3]}.${animated ? "gif" : "png"}`,
  }
}

export default {
  name: "emoji",
  description: "Ajoute au serveur les emojis personnalisés fournis.",
  category: "utils",
  aliases: ["emojis", "em", "addemoji"],
  permissions: ["ManageEmojisAndStickers"],
  usage: "<emoji1 emoji2 ...> | <emoji1emoji2...>",

  async execute(_client: Client, _message: Message, args: string[]) {
    console.log(
      `Command emoji used by ${_message.author.tag} (${_message.author.id}) in the guild ${_message.guild?.name} (${_message.guild?.id}${_message.guild?.vanityURLCode ? ` / .gg/${_message.guild?.vanityURLCode}` : ""})`
    )

    if (!_message.guild) {
      return _message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }

    const input = args.join("").trim()
    if (!input) {
      return _message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Aucun emoji fourni. Exemple : `emoji <:Check:1234> <:Check:5678>`.*")],
      })
    }

    const custom: CustomEmojiInfo[] = []
    const rest = input.replace(CUSTOM_EMOJI_REGEX, (tag) => {
      custom.push(parseCustomEmoji(tag))
      return ""
    })
    const unicodeOnes = [...rest].filter((ch) => ch.trim() !== "")

    if (custom.length === 0) {
      return _message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Aucun emoji personnalisé détecté. Seuls les emojis personnalisés (`<:nom:id>`) peuvent être ajoutés.*")],
      })
    }

    const me = _message.guild.members.me
    if (!me || !me.permissions.has(PermissionFlagsBits.ManageEmojisAndStickers)) {
      return _message.reply({
        embeds: [buildErrorEmbed("403 Forbidden", "> *Le bot n'a pas la permission **Gérer les expressions** (Manage Emojis) sur ce serveur.*")],
      })
    }

    const added: string[] = []
    const failed: { name: string; error: string }[] = []

    for (const emoji of custom) {
      try {
        const created = await _message.guild.emojis.create({
          attachment: emoji.url,
          name: emoji.name,
          reason: `Ajout demandé par ${_message.author.tag} via la commande emoji`,
        })
        added.push(`<:${created.name}:${created.id}>`)
      } catch (error) {
        failed.push({
          name: emoji.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (added.length === 0) {
      return _message.reply({
        embeds: [buildErrorEmbed("500 Internal Server Error", "> *La création des emojis a échoué. Vérifiez la limite d'emojis du serveur et les permissions.*")],
      })
    }

    const embed = new EmbedBuilder()
      .setTitle(" ")
      .setDescription(
        `# ${ADD_TAG} 〃 Emojis ajoutés (${added.length}/${custom.length})\n` +
          `> ***Ajoutés :** ${added.join(" ")}*\n` +
          (failed.length > 0
            ? `> ***Échecs (${failed.length}) :**\n> ${failed.map((f) => `\`${f.name}\` : ${f.error}`).join("\n> ")}`
            : "") +
          (unicodeOnes.length > 0
            ? `\n> *⚠️ Emojis unicode ignorés (impossible de les ajouter) : ${unicodeOnes.join(" ")}*`
            : "")
      )
      .setColor(0x2b2d31)

    return _message.reply({ embeds: [embed] })
  },
}