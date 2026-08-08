import type { Client, Message } from "discord.js"
import { EmbedBuilder } from "discord.js"
import config from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { Guild } from "../../utils/initData.js"

const MAX_PREFIX_LENGTH = 10

export default {
  name: "prefix",
  description: "Affiche ou change le préfixe des commandes sur ce serveur.",
  category: "utils",
  aliases: ["setprefix", "prefixe", "préfix"],
  permissions: ["Administrator"],
  usage: "[new prefix]",
  async execute(_client: Client, _message: Message, _args: string[]) {
    console.log(`Command prefix used by ${_message.author.tag} (${_message.author.id}) in the guild ${_message.guild?.name} (${_message.guild?.id}${_message.guild?.vanityURLCode ? ` / .gg/${_message.guild?.vanityURLCode}` : ""})`)

    if (!_message.guild) {
      return _message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }

    const data = await Guild.findOne({ guildId: _message.guild.id })

    if (!_args.length) {
      const current = data?.prefix ?? config.prefix
      const embed = new EmbedBuilder()
        .setTitle(" ")
        .setDescription(
          `# \`🔧\` 〃 Préfixe\n` +
          `> ***Préfixe actuel:** \`${current}\`*\n\n` +
          `> *Tapez \`${current}prefix <nouveau préfixe>\` pour le changer.*`
        )
      return _message.reply({ embeds: [embed] })
    }

    const newPrefix = _args[0]
    if (newPrefix.length > MAX_PREFIX_LENGTH) {
      return _message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", `> *Le préfixe ne peut pas dépasser ${MAX_PREFIX_LENGTH} caractères.*`)],
      })
    }

    await Guild.findOneAndUpdate(
      { guildId: _message.guild.id },
      { $set: { prefix: newPrefix } },
      { upsert: true, new: true }
    )

    const embed = new EmbedBuilder()
      .setTitle(" ")
      .setDescription(
        `# \`✅\` 〃 Préfixe mis à jour\n` +
        `> ***Le préfixe du bot est maintenant \`${newPrefix}\` sur ce serveur.***`
      )
    return _message.reply({ embeds: [embed] })
  },
}
