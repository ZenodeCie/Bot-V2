import type { Client, Message } from "discord.js"
import parseTime from "../../utils/parseTime.js"
import { extractReason, logCommandUse, replyError, requireGuild } from "../../utils/moderation/helpers.js"
import { createCase, logModCase } from "../../utils/moderation/cases.js"

const MAX_SLOWMODE_SECONDS = 21_600

export default {
  name: "slowmode",
  description: "Modifie le slowmode du salon (durée ou `off`).",
  category: "moderation",
  aliases: ["lent", "sm"],
  permissions: ["ManageChannels"],
  usage: "<durée|off> [raison]",

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("slowmode", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const channel = _message.channel
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      return replyError(_message, "400 Bad Request", "> *Cette commande doit être exécutée dans un salon textuel du serveur.*")
    }
    if (!("setRateLimitPerUser" in channel)) {
      return replyError(_message, "400 Bad Request", "> *Le slowmode n'est pas disponible dans ce salon.*")
    }

    const raw = (args[0] ?? "").toLowerCase()
    const seconds = raw === "off" || raw === "none" || raw === "0" ? 0 : Math.round((parseTime(raw) ?? -1) / 1000)
    if (seconds < 0) {
      return replyError(_message, "400 Bad Request", "> *Durée invalide. Exemples : `5s`, `10m`, `1h`, `off`.*")
    }
    if (seconds > MAX_SLOWMODE_SECONDS) {
      return replyError(_message, "400 Bad Request", "> *Le slowmode maximal est de 6 heures (21600 secondes).*")
    }

    const moderator = { id: _message.author.id, username: _message.author.username }
    const reason = extractReason(args, 1)
    const oldSlowmode = channel.rateLimitPerUser ?? 0

    try {
      await channel.setRateLimitPerUser(seconds, reason)

      const c = await createCase({
        guild,
        target: null,
        moderator,
        action: "SLOWMODE",
        reason,
        channel: { id: channel.id, name: channel.name },
        metadata: { oldSlowmode, newSlowmode: seconds },
      })
      await logModCase(client, c)

      return _message.reply({
        embeds: [
          {
            title: " ",
            description:
              `# \`🐢\` 〃 Slowmode modifié\n` +
              `> ***Salon :** <#${channel.id}>*\n` +
              `> ***Ancien :** ${oldSlowmode > 0 ? `${oldSlowmode}s` : "Désactivé"} → **Nouveau :** ${seconds > 0 ? `${seconds}s` : "Désactivé"}*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Case :** ${c.caseIdFormatted}*`,
            color: 0x2ecc71,
          },
        ],
      })
    } catch (error) {
      console.error("Slowmode failed:", error)
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
