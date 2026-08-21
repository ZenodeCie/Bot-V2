import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType } from "discord.js"
import {
  checkModerationTarget,
  extractReason,
  logCommandUse,
  replyError,
  requireGuild,
  resolveTarget,
} from "../../utils/moderation/helpers.js"
import { createCase, findActiveCase, logModCase, recordDenied, recordFailed } from "../../utils/moderation/cases.js"
import { ACTION_LABELS } from "../../utils/moderation/schema.js"
import { appEmojiHeading } from "../../utils/appEmojis.js"

export default {
  name: "untimeout",
  description: "Retire l'exclusion temporaire d'un membre.",
  category: "moderation",
  aliases: ["finishtimeout", "uto"],
  permissions: ["ModerateMembers"],
  usage: "<@utilisateur> <raison>",
  slash: [
    { name: "utilisateur", description: "Membre", type: ApplicationCommandOptionType.User, required: true },
    { name: "raison", description: "Raison", type: ApplicationCommandOptionType.String, required: true },
  ],

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("untimeout", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const moderator = { id: _message.author.id, username: _message.author.username }
    const action = "UNTIMEOUT" as const
    const reason = extractReason(args, 1)

    const resolved = await resolveTarget(client, guild, args[0] ?? "", true)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)
    const target = resolved.target
    if (!target.member) return replyError(_message, "400 Bad Request", "> *Utilisateur introuvable dans ce serveur.*")
    const targetSnap = { id: target.id, username: target.username, globalName: target.globalName }

    if (!target.member.isCommunicationDisabled()) {
      return replyError(_message, "400 Bad Request", "> *Ce membre n'est actuellement pas exclu temporairement.*")
    }

    const me = await guild.members.fetchMe()
    const hierarchyError = checkModerationTarget(_message.member!, target.member, me)
    if (hierarchyError) {
      await recordDenied(client, { guild, target: targetSnap, moderator, action, reason }, hierarchyError)
      return replyError(_message, "403 Forbidden", `> *${hierarchyError}*`)
    }

    try {
      const previousTimeout = await findActiveCase(guild.id, "timeout", target.id)
      await target.member.timeout(null, reason)

      const c = await createCase({
        guild,
        target: targetSnap,
        moderator,
        action,
        reason,
        linkedCaseId: previousTimeout?.caseId ?? null,
        metadata: { previousTimeoutCase: previousTimeout?.caseIdFormatted ?? null },
      })
      await logModCase(client, c)

      return _message.reply({
        embeds: [
          {
            title: " ",
            description:
              `${appEmojiHeading("check", "Exclusion retirée")}\n` +
              `> ***Utilisateur :** ${target.username} (\`${target.id}\`)*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Case :** ${c.caseIdFormatted}*` +
              (previousTimeout ? `\n> ***Exclusion d'origine :** ${previousTimeout.caseIdFormatted} (toujours consultable)*` : ""),
            color: 0x2ecc71,
          },
        ],
      })
    } catch (error) {
      console.error("Untimeout failed:", error)
      await recordFailed(
        client,
        { guild, target: targetSnap, moderator, action, reason },
        error instanceof Error ? error.message : String(error)
      )
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
