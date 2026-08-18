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
import { createCase, logModCase, notifyUser, recordDenied, recordFailed, updateCaseDm, type DmResult } from "../../utils/moderation/cases.js"
import { ACTION_LABELS, Warning, formatWarningId, nextWarningId } from "../../utils/moderation/schema.js"

export default {
  name: "warn",
  description: "Ajoute un avertissement définitif à un utilisateur.",
  category: "moderation",
  aliases: ["avertir", "w"],
  permissions: ["ManageMessages"],
  usage: "<@utilisateur> <raison>",
  slash: [
    { name: "utilisateur", description: "Utilisateur à avertir", type: ApplicationCommandOptionType.User, required: true },
    { name: "raison", description: "Raison", type: ApplicationCommandOptionType.String, required: true },
  ],

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("warn", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const moderator = { id: _message.author.id, username: _message.author.username }
    const reason = extractReason(args, 1)

    const resolved = await resolveTarget(client, guild, args[0] ?? "", false)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)
    const target = resolved.target

    const action = "WARN" as const
    if (target.member) {
      const me = await guild.members.fetchMe()
      const hierarchyError = checkModerationTarget(_message.member!, target.member, me)
      if (hierarchyError) {
        await recordDenied(
          client,
          { guild, target: { id: target.id, username: target.username, globalName: target.globalName }, moderator, action, reason },
          hierarchyError
        )
        return replyError(_message, "403 Forbidden", `> *${hierarchyError}*`)
      }
    }

    try {
      const warningId = await nextWarningId(guild.id)
      const c = await createCase({
        guild,
        target: { id: target.id, username: target.username, globalName: target.globalName },
        moderator,
        action,
        reason,
        metadata: { warningId },
      })

      await Warning.create({
        warningId,
        warningIdFormatted: formatWarningId(warningId),
        guildId: guild.id,
        userId: target.id,
        username: target.username,
        globalName: target.globalName,
        moderatorId: moderator.id,
        moderatorUsername: moderator.username,
        reason,
        timestamp: c.startedAt,
        caseId: c.caseId,
        caseIdFormatted: c.caseIdFormatted,
        revoked: false,
      })

      let dm: DmResult = { status: "sent" }
      try {
        const user = await client.users.fetch(target.id)
        dm = await notifyUser(user, guild.name, ACTION_LABELS[action], reason, null, c.caseIdFormatted)
      } catch {
        dm = { status: "failed" as const, error: "Utilisateur introuvable." }
      }
      await updateCaseDm(c, dm)
      await logModCase(client, c)

      return _message.reply({
        embeds: [
          {
            title: " ",
            description:
              `# \`⚠️\` 〃 Avertissement ajouté\n` +
              `> ***Utilisateur :** <@${target.id}> (\`${target.id}\`)*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Avertissement :** ${formatWarningId(warningId)}*\n` +
              `> ***Case :** ${c.caseIdFormatted}*` +
              (dm.status === "failed" ? `\n> *⚠️ DM impossible à envoyer : ${dm.error}*` : ""),
            color: 0xf4e00b,
          },
        ],
      })
    } catch (error) {
      console.error("Warn failed:", error)
      await recordFailed(
        client,
        { guild, target: { id: target.id, username: target.username, globalName: target.globalName }, moderator, action, reason },
        error instanceof Error ? error.message : String(error)
      )
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
