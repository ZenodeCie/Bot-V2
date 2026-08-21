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
import { getMuteRole, removeMuteRole } from "../../utils/moderation/mute.js"
import { ACTION_LABELS } from "../../utils/moderation/schema.js"
import { appEmojiHeading } from "../../utils/appEmojis.js"

export default {
  name: "unmute",
  description: "Retire le mute d'un membre.",
  category: "moderation",
  aliases: ["unsilence", "um"],
  permissions: ["ModerateMembers"],
  usage: "<@utilisateur> <raison>",
  slash: [
    { name: "utilisateur", description: "Membre", type: ApplicationCommandOptionType.User, required: true },
    { name: "raison", description: "Raison", type: ApplicationCommandOptionType.String, required: true },
  ],

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("unmute", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const moderator = { id: _message.author.id, username: _message.author.username }
    const action = "UNMUTE" as const
    const reason = extractReason(args, 1)

    const resolved = await resolveTarget(client, guild, args[0] ?? "", true)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)
    const target = resolved.target
    if (!target.member) return replyError(_message, "400 Bad Request", "> *Utilisateur introuvable dans ce serveur.*")
    const targetSnap = { id: target.id, username: target.username, globalName: target.globalName }

    const previousMute = await findActiveCase(guild.id, "mute", target.id)

    const me = await guild.members.fetchMe()
    const hierarchyError = checkModerationTarget(_message.member!, target.member, me)
    if (hierarchyError) {
      await recordDenied(client, { guild, target: targetSnap, moderator, action, reason }, hierarchyError)
      return replyError(_message, "403 Forbidden", `> *${hierarchyError}*`)
    }

    const muteRole = await getMuteRole(guild)
    if (!previousMute && (!muteRole || !target.member.roles.cache.has(muteRole.id))) {
      return replyError(_message, "400 Bad Request", "> *Ce membre n'est actuellement pas muté.*")
    }

    try {
      await removeMuteRole(guild, target.member, reason)

      const c = await createCase({
        guild,
        target: targetSnap,
        moderator,
        action,
        reason,
        linkedCaseId: previousMute?.caseId ?? null,
        metadata: { previousMuteCase: previousMute?.caseIdFormatted ?? null },
      })
      await logModCase(client, c)

      return _message.reply({
        embeds: [
          {
            title: " ",
            description:
              `${appEmojiHeading("check", "Mute retiré")}\n` +
              `> ***Utilisateur :** ${target.username} (\`${target.id}\`)*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Case :** ${c.caseIdFormatted}*` +
              (previousMute ? `\n> ***Mute d'origine :** ${previousMute.caseIdFormatted} (toujours consultable)*` : ""),
            color: 0x2ecc71,
          },
        ],
      })
    } catch (error) {
      console.error("Unmute failed:", error)
      await recordFailed(
        client,
        { guild, target: targetSnap, moderator, action, reason },
        error instanceof Error ? error.message : String(error)
      )
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
