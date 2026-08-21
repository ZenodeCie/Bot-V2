import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { resolveTarget } from "../../utils/moderation/helpers.js"
import { buildLevelsEmbed } from "../../utils/levels/dashboard.js"
import { getMemberRank, getMemberStats, xpProgress } from "../../utils/levels/schema.js"

function progressBar(into: number, needed: number, size = 10): string {
  if (needed <= 0) return "▰".repeat(size)
  const filled = Math.max(0, Math.min(size, Math.round((into / needed) * size)))
  return `${"▰".repeat(filled)}${"▱".repeat(size - filled)}`
}

export default {
  name: "rank",
  description: "Affiche le niveau et l'XP d'un membre.",
  category: "levels",
  aliases: ["lvl", "niveau", "xp"],
  permissions: [],
  usage: "[@utilisateur]",
  slash: [{ name: "utilisateur", description: "Membre à afficher", type: ApplicationCommandOptionType.User, required: false }],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const user = i.options.getUser("utilisateur")
    return user ? [user.id] : []
  },

  async execute(client: Client, message: Message, args: string[]) {
    console.log(
      `Command rank used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
    )

    if (!message.guild) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }

    const targetId = args[0] ? null : message.author.id
    let userId = targetId
    if (!userId) {
      const resolved = await resolveTarget(client, message.guild, args[0] ?? "", false)
      if (!resolved.ok) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", `> *${resolved.error}*`)] })
      }
      userId = resolved.target.id
    }

    const [stats, rank] = await Promise.all([getMemberStats(message.guild.id, userId), getMemberRank(message.guild.id, userId)])
    const progress = xpProgress(stats.xp)

    return message.reply({
      embeds: [
        buildLevelsEmbed(
          "people",
          "Rank",
          `> ***Membre :** <@${userId}>*\n` +
            `> ***Niveau :** \`${progress.level}\`*\n` +
            `> ***XP :** \`${progress.into}\` / \`${progress.needed}\` (\`${progress.total}\` total)*\n` +
            `> ***Rang :** \`#${rank}\`*\n` +
            `> \`${progressBar(progress.into, progress.needed)}\``
        ),
      ],
    })
  },
}
