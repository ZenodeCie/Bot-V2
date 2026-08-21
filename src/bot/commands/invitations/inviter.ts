import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"
import { resolveTarget } from "../../utils/moderation/helpers.js"
import { buildInvitationsEmbed } from "../../utils/invitations/dashboard.js"
import { VANITY_CODE, getJoinRecord } from "../../utils/invitations/schema.js"

const RANK_EMOJI = "<:People:1469693090280505458>"

export default {
  name: "inviter",
  description: "Affiche qui a invité un membre.",
  category: "invitations",
  aliases: ["whoinvited"],
  permissions: [],
  usage: "[@utilisateur]",
  slash: [{ name: "utilisateur", description: "Membre à inspecter", type: ApplicationCommandOptionType.User, required: false }],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const user = i.options.getUser("utilisateur")
    return user ? [user.id] : []
  },

  async execute(client: Client, message: Message, args: string[]) {
    console.log(
      `Command inviter used by ${message.author.tag} (${message.author.id}) in the guild ${message.guild?.name} (${message.guild?.id}${message.guild?.vanityURLCode ? ` / .gg/${message.guild?.vanityURLCode}` : ""})`
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

    const record = await getJoinRecord(message.guild.id, userId)
    if (!record) {
      return message.reply({
        embeds: [
          buildInvitationsEmbed(RANK_EMOJI, "Inviteur", `> *Aucun enregistrement d'invitation pour <@${userId}>.*`),
        ],
      })
    }

    const inviterLabel =
      record.code === VANITY_CODE ? "*URL vanity*" : record.inviterId ? `<@${record.inviterId}>` : "*Inconnu*"
    const joined = record.joinedAt > 0 ? `<t:${Math.floor(record.joinedAt / 1000)}:R>` : "*Inconnu*"
    const status = record.leftAt ? "Parti" : "Présent"

    return message.reply({
      embeds: [
        buildInvitationsEmbed(
          RANK_EMOJI,
          "Inviteur",
          `> ***Membre :** <@${userId}>*\n` +
            `> ***Invité par :** ${inviterLabel}*\n` +
            `> ***Code :** \`${record.code ?? "inconnu"}\`*\n` +
            `> ***Arrivée :** ${joined}*\n` +
            `> ***Type :** \`${record.fake ? "Fake" : "Régulière"}\`*\n` +
            `> ***Statut :** \`${status}\``
        ),
      ],
    })
  },
}
