import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType } from "discord.js"
import { extractReason, logCommandUse, replyError, requireGuild, resolveIdFromArg } from "../../utils/moderation/helpers.js"
import { createCase, findActiveCase, logModCase, notifyUser, recordFailed, updateCaseDm, type DmResult } from "../../utils/moderation/cases.js"
import { ACTION_LABELS } from "../../utils/moderation/schema.js"

export default {
  name: "unban",
  description: "Débannit un utilisateur par son ID (le bannissement d'origine reste dans l'historique).",
  category: "moderation",
  aliases: ["debannir", "ub"],
  permissions: ["BanMembers"],
  usage: "<id> <raison>",
  slash: [
    { name: "utilisateur", description: "Utilisateur à débannir", type: ApplicationCommandOptionType.User, required: true },
    { name: "raison", description: "Raison", type: ApplicationCommandOptionType.String, required: true },
  ],

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("unban", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const moderator = { id: _message.author.id, username: _message.author.username }
    const action = "UNBAN" as const
    const reason = extractReason(args, 1)

    const userId = resolveIdFromArg(args[0] ?? "")
    if (!userId) return replyError(_message, "400 Bad Request", "> *ID d'utilisateur invalide.*")

    const ban = await guild.bans.fetch(userId).catch(() => null)
    if (!ban) {
      return replyError(_message, "400 Bad Request", "> *Cet utilisateur n'est pas banni de ce serveur.*")
    }

    const targetSnap = {
      id: userId,
      username: ban.user.username,
      globalName: ban.user.globalName ?? null,
    }

    try {
      const previousBan = await findActiveCase(guild.id, "ban", userId)
      await guild.bans.remove(userId, reason)

      const c = await createCase({
        guild,
        target: targetSnap,
        moderator,
        action,
        reason,
        linkedCaseId: previousBan?.caseId ?? null,
        metadata: previousBan ? { previousBanCase: previousBan.caseIdFormatted } : { previousBanCase: null },
      })

      let dm: DmResult = { status: "sent" }
      try {
        const user = await client.users.fetch(userId)
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
              `# \`🔓\` 〃 Utilisateur débanni\n` +
              `> ***Utilisateur :** ${targetSnap.username} (\`${userId}\`)*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Case :** ${c.caseIdFormatted}*` +
              (previousBan ? `\n> ***Bannissement d'origine :** ${previousBan.caseIdFormatted} (toujours consultable)*` : "") +
              (dm.status === "failed" ? `\n> *⚠️ DM impossible à envoyer : ${dm.error}*` : ""),
            color: 0x2ecc71,
          },
        ],
      })
    } catch (error) {
      console.error("Unban failed:", error)
      await recordFailed(
        client,
        { guild, target: targetSnap, moderator, action, reason },
        error instanceof Error ? error.message : String(error)
      )
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
