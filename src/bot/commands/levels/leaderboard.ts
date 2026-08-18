import type { Client, Message } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildLevelsEmbed } from "../../utils/levels/dashboard.js"
import { listLeaderboard } from "../../utils/levels/schema.js"

const RANK_EMOJI = "<:People:1469693090280505458>"

export default {
  name: "leaderboard",
  description: "Affiche le classement des niveaux du serveur.",
  category: "levels",
  aliases: ["lb", "classement", "top"],
  permissions: [],
  usage: "",

  async execute(_client: Client, message: Message) {
    console.log(
      `Command leaderboard used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
    )

    if (!message.guild) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }

    const top = await listLeaderboard(message.guild.id, 10)
    if (top.length === 0) {
      return message.reply({
        embeds: [buildLevelsEmbed(RANK_EMOJI, "Classement", "> *Aucun membre n'a encore gagné d'XP.*")],
      })
    }

    const lines = top.map((entry, index) => {
      return `> \`${index + 1}.\` <@${entry.userId}> — niveau \`${entry.level}\` (\`${entry.xp}\` XP)`
    })

    return message.reply({
      embeds: [buildLevelsEmbed(RANK_EMOJI, `Classement (${top.length})`, lines.join("\n"))],
    })
  },
}
