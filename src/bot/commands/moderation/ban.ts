import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js"
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
import { ACTION_LABELS } from "../../utils/moderation/schema.js"
import { appEmojiHeading, appEmojiText } from "../../utils/appEmojis.js"

export default {
  name: "ban",
  description: "Bannit un utilisateur (membre présent ou par ID). Option `d:<jours>` pour supprimer ses messages.",
  category: "moderation",
  aliases: ["bannir", "b"],
  permissions: ["BanMembers"],
  usage: "<@utilisateur|id> <raison> [d:0-7]",
  slash: [
    { name: "utilisateur", description: "Utilisateur à bannir", type: ApplicationCommandOptionType.User, required: true },
    { name: "raison", description: "Raison", type: ApplicationCommandOptionType.String, required: true },
    { name: "jours", description: "Jours de messages à supprimer (0-7)", type: ApplicationCommandOptionType.Integer, required: false, minValue: 0, maxValue: 7 },
  ],
  slashArgs: (i: ChatInputCommandInteraction) => {
    const args = [i.options.getUser("utilisateur")!.id, i.options.getString("raison") ?? ""]
    const jours = i.options.getInteger("jours")
    if (jours !== null) args.push(`d:${jours}`)
    return args
  },

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("ban", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const moderator = { id: _message.author.id, username: _message.author.username }
    const action = "BAN" as const
    const deleteDays = parseDeleteDays(args)
    const reason = extractReason(args, 1).replace(/d:[0-7]/i, "").replace(/\s{2,}/g, " ").trim() || "Aucune raison fournie"

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
      const c = await createCase({
        guild,
        target: targetSnap,
        moderator,
        action,
        reason,
        metadata: { deleteMessageSeconds: deleteDays },
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
              `${appEmojiHeading("cancel", "Utilisateur banni")}\n` +
              `> ***Utilisateur :** ${target.username} (\`${target.id}\`)*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Suppression des messages :** ${deleteDays > 0 ? `les ${deleteDays} dernier(s) jour(s)` : "Aucune"}*\n` +
              `> ***Case :** ${c.caseIdFormatted}*` +
              (dm.status === "failed" ? `\n> *${appEmojiText("cancel")} DM impossible à envoyer : ${dm.error}*` : ""),
            color: 0x2ecc71,
          },
        ],
      })
    } catch (error) {
      console.error("Ban failed:", error)
      await recordFailed(
        client,
        { guild, target: targetSnap, moderator, action, reason },
        error instanceof Error ? error.message : String(error)
      )
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
