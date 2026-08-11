import type { Client, Message } from "discord.js"
import parseTime from "../../utils/parseTime.js"
import {
  checkModerationTarget,
  extractReason,
  logCommandUse,
  replyError,
  requireGuild,
  resolveTarget,
} from "../../utils/moderation/helpers.js"
import { createCase, findActiveCase, logModCase, notifyUser, recordDenied, recordFailed, updateCaseDm, type DmResult } from "../../utils/moderation/cases.js"
import { addMuteRole } from "../../utils/moderation/mute.js"
import { registerTempSanction } from "../../utils/moderation/temp.js"
import { ACTION_LABELS } from "../../utils/moderation/schema.js"

const MIN_TEMP_DURATION = 30_000
const MAX_TEMP_DURATION = 365 * 86_400_000

export default {
  name: "tempmute",
  description: "Mute temporairement un membre (retrait automatique à l'expiration).",
  category: "moderation",
  aliases: ["tmute", "tm"],
  permissions: ["ModerateMembers"],
  usage: "<@utilisateur> <durée> <raison>",

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("tempmute", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const moderator = { id: _message.author.id, username: _message.author.username }
    const action = "TEMPMUTE" as const

    const duration = parseTime(args[1] ?? "")
    if (duration === null || duration < MIN_TEMP_DURATION) {
      return replyError(_message, "400 Bad Request", "> *Durée invalide (minimum 30 secondes). Exemples : `10m`, `1h`, `7d`.*")
    }
    if (duration > MAX_TEMP_DURATION) {
      return replyError(_message, "400 Bad Request", "> *La durée maximale est de 365 jours.*")
    }

    const reason = extractReason(args, 2)

    const resolved = await resolveTarget(client, guild, args[0] ?? "", true)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)
    const target = resolved.target
    if (!target.member) return replyError(_message, "400 Bad Request", "> *Utilisateur introuvable dans ce serveur.*")
    const targetSnap = { id: target.id, username: target.username, globalName: target.globalName }

    const existingMute = await findActiveCase(guild.id, "mute", target.id)
    if (existingMute) {
      return replyError(
        _message,
        "409 Conflict",
        `> *Ce membre est déjà muté (case **${existingMute.caseIdFormatted}**). Utilisez \`unmute\` avant.*`
      )
    }

    const me = await guild.members.fetchMe()
    const hierarchyError = checkModerationTarget(_message.member!, target.member, me)
    if (hierarchyError) {
      await recordDenied(client, { guild, target: targetSnap, moderator, action, reason }, hierarchyError)
      return replyError(_message, "403 Forbidden", `> *${hierarchyError}*`)
    }

    try {
      const role = await addMuteRole(guild, target.member, reason)
      if (!role) {
        const error = "Impossible de créer ou de retrouver le rôle de mute."
        await recordDenied(client, { guild, target: targetSnap, moderator, action, reason }, error)
        return replyError(_message, "500 Internal Server Error", `> *${error}*`)
      }

      const endAt = Date.now() + duration
      const c = await createCase({
        guild,
        target: targetSnap,
        moderator,
        action,
        reason,
        duration,
        endAt,
        metadata: { temporary: true, muteRoleId: role.id },
      })

      registerTempSanction(client, { guildId: guild.id, userId: target.id, type: "TEMPMUTE", caseId: c.caseId, expiresAt: endAt })

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
              `# \`⌛\` 〃 Mute temporaire\n` +
              `> ***Utilisateur :** ${target.username} (\`${target.id}\`)*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Durée :** ${duration / 1000}s (retrait automatique le <t:${Math.floor(endAt / 1000)}:T>)*\n` +
              `> ***Case :** ${c.caseIdFormatted}*` +
              (dm.status === "failed" ? `\n> *⚠️ DM impossible à envoyer : ${dm.error}*` : ""),
            color: 0x2ecc71,
          },
        ],
      })
    } catch (error) {
      console.error("Tempmute failed:", error)
      await recordFailed(
        client,
        { guild, target: targetSnap, moderator, action, reason },
        error instanceof Error ? error.message : String(error)
      )
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
