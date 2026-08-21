import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType } from "discord.js"
import { formatDate, logCommandUse, replyError, requireGuild, resolveTarget } from "../../utils/moderation/helpers.js"
import { ModCase, Warning, ACTION_EMOJIS, ACTION_LABELS, STATUS_LABELS } from "../../utils/moderation/schema.js"
import { buildNavRow, handlePageNav, type PageRenderResult } from "../../utils/moderation/pagination.js"
import { appEmojiHeading, appEmojiText } from "../../utils/appEmojis.js"

const PER_PAGE = 6

async function renderHistoryPage(guildId: string, userId: string, page: number): Promise<PageRenderResult> {
  const all = await ModCase.find({ guildId, userId }).sort({ caseId: -1 }).lean()
  const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE))
  const safe = Math.min(page, totalPages - 1)
  const slice = all.slice(safe * PER_PAGE, (safe + 1) * PER_PAGE)

  const activeWarnings = await Warning.countDocuments({ guildId, userId, revoked: false })

  const lines = slice.map((c) => {
    const duration =
      c.duration && c.duration > 0 ? ` • **Durée :** ${c.duration / 1000}s` : ""
    const linked = c.linkedCaseIdFormatted ? ` • **Liée :** ${c.linkedCaseIdFormatted}` : ""
    return (
      `> **${c.caseIdFormatted}** — ${appEmojiText(ACTION_EMOJIS[c.action])} **${ACTION_LABELS[c.action]}** — \`${STATUS_LABELS[c.status]}\`${duration}${linked}\n` +
      `> ***Raison :** ${c.reason}*\n` +
      `> ***Modérateur :** ${c.moderatorUsername} (\`${c.moderatorId ?? "auto"}\`) • ${formatDate(c.startedAt)} (<t:${Math.floor(c.startedAt / 1000)}:R>)*`
    )
  })

  const embed = {
    title: " ",
    description:
      `${appEmojiHeading("file", `Historique de modération de <@${userId}> (\`${userId}\`)`)}\n` +
      `> ***Cas enregistrés :** ${all.length} • Avertissements actifs : ${activeWarnings}*\n\n` +
      (lines.join("\n\n") || "> *Aucune action de modération enregistrée.*") +
      `\n\n> ***Page :** ${safe + 1}/${totalPages}*`,
    color: 0xf47c0b,
  }

  return { embeds: [embed], totalPages }
}

export default {
  name: "history",
  description: "Affiche l'intégralité de l'historique de modération d'un utilisateur.",
  category: "moderation",
  aliases: ["hist", "historique"],
  permissions: ["ManageMessages"],
  usage: "<@utilisateur|id>",
  slash: [
    { name: "utilisateur", description: "Utilisateur", type: ApplicationCommandOptionType.User, required: true },
  ],

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("history", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const resolved = await resolveTarget(client, guild, args[0] ?? "", false)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)

    const { embeds, totalPages } = await renderHistoryPage(guild.id, resolved.target.id, 0)
    return _message.reply({
      embeds,
      components: [buildNavRow("history", guild.id, _message.author.id, resolved.target.id, 0, totalPages)],
    })
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handlePageNav(interaction, "history", renderHistoryPage)
  },
}
