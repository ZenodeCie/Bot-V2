import { PermissionFlagsBits, type Client, type Message } from "discord.js"
import { logCommandUse, replyError, requireGuild, resolveTarget } from "../../utils/moderation/helpers.js"
import { createCase, logModCase } from "../../utils/moderation/cases.js"

const PURGE_TYPES = ["all", "user", "contains", "links", "files", "images", "bots"] as const
type PurgeType = (typeof PURGE_TYPES)[number]

const LINK_REGEX = /https?:\/\/[^\s<>]+|(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-zA-Z0-9_-]+/i

export default {
  name: "purge",
  description: "Purge des messages avec filtre (all, user, contains, links, files, images, bots).",
  category: "moderation",
  aliases: ["prune", "pr"],
  permissions: ["ManageMessages"],
  usage: "<type|nombre> <nombre> [@utilisateur|texte]",

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("purge", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const channel = _message.channel
    if (!channel || !channel.isTextBased() || !channel.isSendable() || channel.isDMBased()) {
      return replyError(_message, "400 Bad Request", "> *Cette commande doit être exécutée dans un salon textuel du serveur.*")
    }

    let type: PurgeType = "all"
    let rest = args
    if (PURGE_TYPES.includes(args[0]?.toLowerCase() as PurgeType)) {
      type = args[0]!.toLowerCase() as PurgeType
      rest = args.slice(1)
    }

    const amount = Number(rest[0])
    if (!Number.isInteger(amount) || amount < 1 || amount > 500) {
      return replyError(
        _message,
        "400 Bad Request",
        "> *Nombre invalide (entier entre 1 et 500). Exemples : `purge 50`, `purge user @bob 30`, `purge contains spam 25`.*"
      )
    }

    const moderator = { id: _message.author.id, username: _message.author.username }

    let userId: string | null = null
    let text: string | null = null
    if (type === "user") {
      const resolved = await resolveTarget(client, guild, rest[1] ?? "", false)
      if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)
      userId = resolved.target.id
    }
    if (type === "contains") {
      text = rest.slice(1).join(" ").trim()
      if (!text) return replyError(_message, "400 Bad Request", "> *Précisez le texte à rechercher : `purge contains <texte> <nombre>`.*")
    }

    const bot = await guild.members.fetchMe()
    if (!channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageMessages)) {
      return replyError(_message, "403 Forbidden", "> *Le bot ne possède pas la permission `Manage Messages` dans ce salon.*")
    }

    try {
      const filter = (msg: { author: { id: string; bot: boolean }; content: string; attachments: { size: number }; embeds: { image: unknown; thumbnail: unknown }[] }) => {
        switch (type) {
          case "user":
            return msg.author.id === userId
          case "contains":
            return msg.content.toLowerCase().includes((text ?? "").toLowerCase())
          case "links":
            return LINK_REGEX.test(msg.content)
          case "files":
            return msg.attachments.size > 0
          case "images":
            return (
              msg.attachments.size > 0 ||
              msg.embeds.some((e) => e.image !== null || e.thumbnail !== null)
            )
          case "bots":
            return msg.author.bot
          default:
            return true
        }
      }

      let deleted = 0
      let failed = 0
      while (deleted < amount) {
        const messages = await channel.messages.fetch({ limit: 100 })
        const batch = [...messages.filter((m) => !m.pinned && filter(m)).values()].slice(0, amount - deleted)
        if (batch.length === 0) break
        const res = await channel.bulkDelete(batch, true)
        deleted += res.size
        if (res.size < batch.length) failed += batch.length - res.size
      }

      const c = await createCase({
        guild,
        target: null,
        moderator,
        action: "PURGE",
        reason: `Purge manuelle (type : \`${type}\`${userId ? `, utilisateur : ${userId}` : ""}${text ? `, contient : "${text}"` : ""})`,
        channel: { id: channel.id, name: channel.name },
        metadata: { type, requested: amount, deleted, failed, userId, text },
      })
      await logModCase(client, c)

      return _message.reply({
        embeds: [
          {
            title: " ",
            description:
              `# \`🧹\` 〃 Purge effectuée\n` +
              `> ***Filtre :** \`${type}\`${userId ? ` — <@${userId}>` : ""}${text ? ` — "${text}"` : ""}\n` +
              `> ***Salon :** <#${channel.id}>*\n` +
              `> ***Demandé :** ${amount} • **Supprimé :** ${deleted}` +
              (failed > 0 ? ` • **Échec :** ${failed}` : "") +
              `*\n` +
              `> ***Case :** ${c.caseIdFormatted}*`,
            color: 0x2ecc71,
          },
        ],
      })
    } catch (error) {
      console.error("Purge failed:", error)
      return replyError(_message, "500 Internal Server Error", `> *Une erreur est survenue : \`${error}\`*`)
    }
  },
}
