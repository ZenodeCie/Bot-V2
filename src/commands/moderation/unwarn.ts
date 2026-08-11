import type { Client, Message } from "discord.js"
import {
  extractReason,
  logCommandUse,
  parseWarningIdArg,
  replyError,
  requireGuild,
  resolveTarget,
} from "../../utils/moderation/helpers.js"
import { createCase, logModCase, recordFailed } from "../../utils/moderation/cases.js"
import { ACTION_LABELS, Warning, formatWarningId } from "../../utils/moderation/schema.js"

export default {
  name: "unwarn",
  description: "Révoque un avertissement précis (il reste visible dans l'historique).",
  category: "moderation",
  aliases: ["removewarn", "uw"],
  permissions: ["ManageMessages"],
  usage: "<@utilisateur> <id_avertissement|all> <raison>",

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("unwarn", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const moderator = { id: _message.author.id, username: _message.author.username }
    const resolved = await resolveTarget(client, guild, args[0] ?? "", false)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)
    const target = resolved.target

    const reason = extractReason(args, 2)

    const idArg = args[1]?.toLowerCase()
    if (idArg === "all") {
      return replyError(
        _message,
        "400 Bad Request",
        "> *Utilisez la commande \`clearwarnings\` pour révoquer tous les avertissements d'un utilisateur.*"
      )
    }

    const warningId = parseWarningIdArg(idArg ?? "")
    if (warningId === null) {
      return replyError(_message, "400 Bad Request", "> *ID d'avertissement invalide. Exemples : \`3\`, \`#3\`, \`WARN-0003\`.*")
    }

    const warning = await Warning.findOne({ guildId: guild.id, warningId, userId: target.id })
    if (!warning) {
      return replyError(_message, "404 Not Found", `> *Aucun avertissement **${formatWarningId(warningId)}** trouvé pour cet utilisateur.*`)
    }
    if (warning.revoked) {
      return replyError(_message, "409 Conflict", `> *L'avertissement **${formatWarningId(warningId)}** a déjà été révoqué.*`)
    }

    const action = "UNWARN" as const
    try {
      const c = await createCase({
        guild,
        target: { id: target.id, username: target.username, globalName: target.globalName },
        moderator,
        action,
        reason,
        linkedCaseId: warning.caseId,
        metadata: { warningId, originalWarningIdFormatted: warning.warningIdFormatted },
      })

      await Warning.updateOne(
        { _id: warning._id },
        {
          $set: {
            revoked: true,
            revokedBy: moderator.id,
            revokedAt: c.startedAt,
            revokeReason: reason,
            revokedCaseId: c.caseId,
          },
        }
      )

      await logModCase(client, c)

      return _message.reply({
        embeds: [
          {
            title: " ",
            description:
              `# \`♻️\` 〃 Avertissement révoqué\n` +
              `> ***Utilisateur :** <@${target.id}> (\`${target.id}\`)*\n` +
              `> ***Avertissement :** ${formatWarningId(warningId)}*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Case d'origine :** ${warning.caseIdFormatted}*\n` +
              `> ***Case de révocation :** ${c.caseIdFormatted}*`,
            color: 0xf39c12,
          },
        ],
      })
    } catch (error) {
      console.error("Unwarn failed:", error)
      await recordFailed(
        client,
        { guild, target: { id: target.id, username: target.username, globalName: target.globalName }, moderator, action, reason },
        error instanceof Error ? error.message : String(error)
      )
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
