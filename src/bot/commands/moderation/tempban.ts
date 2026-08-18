import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
import parseTime from "../../utils/parseTime.js"
import {
  checkModerationTarget,
  extractReason,
  logCommandUse,
  parseDeleteDays,
  replyError,
  requireGuild,
  resolveTarget,
} from "../../utils/moderation/helpers.js"
import { createCase, logModCase, notifyUser, recordDenied, recordFailed, updateCaseDm, type DmResult } from "../../utils/moderation/cases.js"
import { registerTempSanction } from "../../utils/moderation/temp.js"
import { ACTION_LABELS } from "../../utils/moderation/schema.js"

const MIN_TEMP_DURATION = 30_000
const MAX_TEMP_DURATION = 10 * 365 * 86_400_000

export default {
  name: "tempban",
  description: "Bannit temporairement un utilisateur (débannissement automatique à l'expiration).",
  category: "moderation",
  aliases: ["tban", "tb"],
  permissions: ["BanMembers"],
  usage: "<@utilisateur|id> <durée> <raison> [d:0-7]",
  slash: [
    { name: "utilisateur", description: "Utilisateur", type: ApplicationCommandOptionType.User, required: true },
    { name: "duree", description: "Durée", type: ApplicationCommandOptionType.String, required: true },
    { name: "raison", description: "Raison", type: ApplicationCommandOptionType.String, required: true },
    { name: "jours", description: "Jours de messages à supprimer (0-7)", type: ApplicationCommandOptionType.Integer, required: false, minValue: 0, maxValue: 7 },
  ],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const args = [i.options.getUser("utilisateur")!.id, i.options.getString("duree") ?? "", i.options.getString("raison") ?? ""]
    const jours = i.options.getInteger("jours")
    if (jours !== null) args.push(`d:${jours}`)
    return args
  },

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("tempban", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const moderator = { id: _message.author.id, username: _message.author.username }
    const action = "TEMPBAN" as const

    const duration = parseTime(args[1] ?? "")
    if (duration === null || duration < MIN_TEMP_DURATION) {
      return replyError(_message, "400 Bad Request", "> *Durée invalide (minimum 30 secondes). Exemples : `10m`, `1h`, `7d`.*")
    }
    if (duration > MAX_TEMP_DURATION) {
      return replyError(_message, "400 Bad Request", "> *La durée maximale est de 10 ans.*")
    }

    const deleteDays = parseDeleteDays(args)
    const reason = extractReason(args, 2).replace(/d:[0-7]/i, "").replace(/\s{2,}/g, " ").trim() || "Aucune raison fournie"

    const resolved = await resolveTarget(client, guild, args[0] ?? "", false)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)
    const target = resolved.target
    const targetSnap = { id: target.id, username: target.username, globalName: target.globalName }

    if (target.member) {
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
    }

    try {
      await guild.members.ban(target.id, { reason, deleteMessageSeconds: deleteDays })
      const endAt = Date.now() + duration

      const c = await createCase({
        guild,
        target: targetSnap,
        moderator,
        action,
        reason,
        duration,
        endAt,
        metadata: { temporary: true, deleteMessageSeconds: deleteDays },
      })

      registerTempSanction(client, { guildId: guild.id, userId: target.id, type: "TEMPBAN", caseId: c.caseId, expiresAt: endAt })

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
              `# \`⏳\` 〃 Bannissement temporaire\n` +
              `> ***Utilisateur :** ${target.username} (\`${target.id}\`)*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Durée :** ${duration / 1000}s (débannissement automatique le <t:${Math.floor(endAt / 1000)}:T>)*\n` +
              `> ***Case :** ${c.caseIdFormatted}*` +
              (dm.status === "failed" ? `\n> *⚠️ DM impossible à envoyer : ${dm.error}*` : ""),
            color: 0x2ecc71,
          },
        ],
      })
    } catch (error) {
      console.error("Tempban failed:", error)
      await recordFailed(
        client,
        { guild, target: targetSnap, moderator, action, reason },
        error instanceof Error ? error.message : String(error)
      )
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
