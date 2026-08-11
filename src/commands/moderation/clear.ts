import { PermissionFlagsBits, type Client, type Message } from "discord.js"
import { extractReason, logCommandUse, replyError, requireGuild } from "../../utils/moderation/helpers.js"
import { createCase, logModCase } from "../../utils/moderation/cases.js"

export default {
  name: "clear",
  description: "Supprime un nombre précis de messages du salon.",
  category: "moderation",
  aliases: ["clean", "cl"],
  permissions: ["ManageMessages"],
  usage: "<nombre> [raison]",

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("clear", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const channel = _message.channel
    if (!channel || !channel.isTextBased() || !channel.isSendable() || channel.isDMBased()) {
      return replyError(_message, "400 Bad Request", "> *Cette commande doit être exécutée dans un salon textuel du serveur.*")
    }

    const amount = Number(args[0])
    if (!Number.isInteger(amount) || amount < 1 || amount > 500) {
      return replyError(_message, "400 Bad Request", "> *Nombre invalide (entier entre 1 et 500).*")
    }

    const moderator = { id: _message.author.id, username: _message.author.username }
    const reason = extractReason(args, 1)

    try {
      let deleted = 0
      let failed = 0
      while (deleted < amount) {
        const messages = await channel.messages.fetch({ limit: Math.min(100, amount - deleted) })
        if (messages.size === 0) break
        const res = await channel.bulkDelete(messages, true)
        deleted += res.size
        if (res.size < messages.size) failed += messages.size - res.size
        if (messages.size < 100) break
      }

      const c = await createCase({
        guild,
        target: null,
        moderator,
        action: "CLEAR",
        reason,
        channel: { id: channel.id, name: channel.name },
        metadata: { requested: amount, deleted, failed },
      })
      await logModCase(client, c)

      return _message.reply({
        embeds: [
          {
            title: " ",
            description:
              `# \`🧹\` 〃 Messages supprimés\n` +
              `> ***Salon :** <#${channel.id}>*\n` +
              `> ***Demandé :** ${amount} • **Supprimé :** ${deleted}` +
              (failed > 0 ? ` • **Échec (messages > 14 jours) :** ${failed}` : "") +
              `*\n` +
              `> ***Raison :** ${reason}*\n` +
              `> ***Case :** ${c.caseIdFormatted}*`,
            color: 0x2ecc71,
          },
        ],
      })
    } catch (error) {
      console.error("Clear failed:", error)
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
