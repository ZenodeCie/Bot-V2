import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType } from "discord.js"
import parseTime from "../../utils/parseTime.js"
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

const MAX_TIMEOUT_MS = 28 * 86_400_000

export default {
  name: "timeout",
  description: "Exclut temporairement un membre (durées : 10s à 28d).",
  category: "moderation",
  aliases: ["exclure", "to"],
  permissions: ["ModerateMembers"],
  usage: "<@utilisateur> <durée> <raison>",
  slash: [
    { name: "utilisateur", description: "Membre", type: ApplicationCommandOptionType.User, required: true },
    { name: "duree", description: "Durée (10s à 28d)", type: ApplicationCommandOptionType.String, required: true },
    { name: "raison", description: "Raison", type: ApplicationCommandOptionType.String, required: true },
  ],

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("timeout", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const moderator = { id: _message.author.id, username: _message.author.username }
    const action = "TIMEOUT" as const

    const duration = parseTime(args[1] ?? "")
    if (duration === null || duration <= 0) {
      return replyError(_message, "400 Bad Request", "> *Durée invalide. Exemples : `10s`, `30m`, `1h`, `7d`, `28d`.*")
    }
    if (duration < 10_000) {
      return replyError(_message, "400 Bad Request", "> *La durée minimale est de 10 secondes.*")
    }
    if (duration > MAX_TIMEOUT_MS) {
      return replyError(_message, "400 Bad Request", "> *La durée maximale d'une exclusion est de 28 jours.*")
    }

    const reason = extractReason(args, 2)

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

    if (!target.member.moderatable) {
      const error = "Le bot ne peut pas exclure temporairement ce membre (permissions ou hiérarchie insuffisantes)."
      await recordDenied(client, { guild, target: targetSnap, moderator, action, reason }, error)
      return replyError(_message, "403 Forbidden", `> *${error}*`)
    }

    try {
      await target.member.timeout(duration, reason)
      const endAt = Date.now() + duration
      const c = await createCase({
        guild,
        target: targetSnap,
        moderator,
        action,
        reason,
        duration,
        endAt,
      })

      let dm: DmResult = { status: "sent" }
      try {
        const user = await client.users.fetch(target.id)
        dm = await notifyUser(user, guild.name, ACTION_LABELS[action], reason, duration, c.caseIdFormatted)
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
              `# \`⏱️\` 〃 Exclusion temporaire\n` +
              `> ***Utilisateur :** ${target.username} (\`${target.id}\`)*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Durée :** ${duration / 1000}s (jusqu'au <t:${Math.floor(endAt / 1000)}:T>)*\n` +
              `> ***Case :** ${c.caseIdFormatted}*` +
              (dm.status === "failed" ? `\n> *⚠️ DM impossible à envoyer : ${dm.error}*` : ""),
            color: 0x2ecc71,
          },
        ],
      })
    } catch (error) {
      console.error("Timeout failed:", error)
      await recordFailed(
        client,
        { guild, target: targetSnap, moderator, action, reason },
        error instanceof Error ? error.message : String(error)
      )
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
