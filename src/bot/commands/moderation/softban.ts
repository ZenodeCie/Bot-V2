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
import { ACTION_LABELS } from "../../utils/moderation/schema.js"

export default {
  name: "softban",
  description: "Bannit puis débannit immédiatement l'utilisateur (supprime ses messages récents).",
  category: "moderation",
  aliases: ["sb"],
  permissions: ["BanMembers"],
  usage: "<@utilisateur> <raison>",
  slash: [
    { name: "utilisateur", description: "Utilisateur", type: ApplicationCommandOptionType.User, required: true },
    { name: "raison", description: "Raison", type: ApplicationCommandOptionType.String, required: true },
  ],

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("softban", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const moderator = { id: _message.author.id, username: _message.author.username }
    const action = "SOFTBAN" as const
    const reason = extractReason(args, 1)

    const resolved = await resolveTarget(client, guild, args[0] ?? "", true)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)
    const target = resolved.target
    if (!target.member) return replyError(_message, "400 Bad Request", "> *Utilisateur introuvable dans ce serveur.*")
    const targetSnap = { id: target.id, username: target.username, globalName: target.globalName }

    const me = await guild.members.fetchMe()
    const hierarchyError = checkModerationTarget(_message.member!, target.member, me)
    if (hierarchyError) {
      await recordDenied(client, { guild, target: targetSnap, moderator, action, reason }, hierarchyError)
      return replyError(_message, "403 Forbidden", `> *${hierarchyError}*`)
    }

    if (!target.member.bannable) {
      const error = "Le bot ne peut pas bannir ce membre (permissions ou hiérarchie insuffisantes)."
      await recordDenied(client, { guild, target: targetSnap, moderator, action, reason }, error)
      return replyError(_message, "403 Forbidden", `> *${error}*`)
    }

    try {
      await target.member.ban({ reason, deleteMessageSeconds: 7 })
      await guild.bans.remove(target.id, "Softban terminé (débannissement immédiat)")

      const c = await createCase({
        guild,
        target: targetSnap,
        moderator,
        action,
        reason,
        metadata: { messagesDeleted: true, deleteMessageSeconds: 7, unbanImmediate: true },
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
              `# \`🧹\` 〃 Softban effectué\n` +
              `> ***Utilisateur :** ${target.username} (\`${target.id}\`)*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> *L'utilisateur a été banni, ses 7 derniers jours de messages supprimés, puis immédiatement débanni.*\n` +
              `> ***Case :** ${c.caseIdFormatted}*` +
              (dm.status === "failed" ? `\n> *⚠️ DM impossible à envoyer : ${dm.error}*` : ""),
            color: 0x2ecc71,
          },
        ],
      })
    } catch (error) {
      console.error("Softban failed:", error)
      await recordFailed(
        client,
        { guild, target: targetSnap, moderator, action, reason },
        error instanceof Error ? error.message : String(error)
      )
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
