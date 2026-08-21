import type { Client, Message } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { buildInvitationsEmbed } from "../../utils/invitations/dashboard.js"
import { listLeaderboard } from "../../utils/invitations/schema.js"

const RANK_EMOJI = "<:People:1469693090280505458>"

export default {
  name: "inviteleaderboard",
  description: "Affiche le classement des invitations du serveur.",
  category: "invitations",
  aliases: ["invitestop", "ilb", "topinvites"],
  permissions: [],
  usage: "",

  async execute(_client: Client, message: Message) {
    console.log(
      `Command inviteleaderboard used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
    )

    if (!message.guild) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }

    const top = await listLeaderboard(message.guild.id, 10)
    if (top.length === 0) {
      return message.reply({
        embeds: [buildInvitationsEmbed(RANK_EMOJI, "Classement", "> *Aucun membre n'a encore d'invitations.*")],
      })
    }

    const lines = top.map((entry, index) => {
      return `> \`${index + 1}.\` <@${entry.userId}> — \`${entry.total}\` (\`${entry.regular}\` rég. · \`${entry.bonus}\` bonus)`
    })

    return message.reply({
      embeds: [buildInvitationsEmbed(RANK_EMOJI, `Classement (${top.length})`, lines.join("\n"))],
    })
  },
}
