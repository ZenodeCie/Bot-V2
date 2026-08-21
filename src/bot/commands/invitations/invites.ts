import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { resolveTarget } from "../../utils/moderation/helpers.js"
import { buildInvitationsEmbed } from "../../utils/invitations/dashboard.js"
import { getMemberInvites, getMemberRank, inviteTotal } from "../../utils/invitations/schema.js"

const RANK_EMOJI = "<:People:1469693090280505458>"

export default {
  name: "invites",
  description: "Affiche les invitations d'un membre.",
  category: "invitations",
  aliases: ["invite", "inv"],
  permissions: [],
  usage: "[@utilisateur]",
  slash: [{ name: "utilisateur", description: "Membre à afficher", type: ApplicationCommandOptionType.User, required: false }],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const user = i.options.getUser("utilisateur")
    return user ? [user.id] : []
  },

  async execute(client: Client, message: Message, args: string[]) {
    console.log(
      `Command invites used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
    )

    if (!message.guild) {
      return message.reply({
        embeds: [buildErrorEmbed("400 Bad Request", "> *Cette commande doit être exécutée dans un serveur.*")],
      })
    }

    let userId = args[0] ? null : message.author.id
    if (!userId) {
      const resolved = await resolveTarget(client, message.guild, args[0] ?? "", false)
      if (!resolved.ok) {
        return message.reply({ embeds: [buildErrorEmbed("400 Bad Request", `> *${resolved.error}*`)] })
      }
      userId = resolved.target.id
    }

    const [stats, rank] = await Promise.all([
      getMemberInvites(message.guild.id, userId),
      getMemberRank(message.guild.id, userId),
    ])
    const total = inviteTotal(stats)

    return message.reply({
      embeds: [
        buildInvitationsEmbed(
          RANK_EMOJI,
          "Invitations",
          `> ***Membre :** <@${userId}>*\n` +
            `> ***Total :** \`${total}\`*\n` +
            `> ***Régulières :** \`${stats.regular}\`* · ***Bonus :** \`${stats.bonus}\`*\n` +
            `> ***Fakes :** \`${stats.fake}\`* · ***Leaves :** \`${stats.left}\`*\n` +
            `> ***Rang :** \`#${rank}\``
        ),
      ],
    })
  },
}
