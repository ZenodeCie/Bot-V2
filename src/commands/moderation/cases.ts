import type { Client, Message } from "discord.js"
import { formatDate, logCommandUse, replyError, requireGuild, resolveTarget } from "../../utils/moderation/helpers.js"
import { ModCase, ACTION_EMOJIS, ACTION_LABELS, STATUS_LABELS } from "../../utils/moderation/schema.js"
import { buildNavRow, handlePageNav, type PageRenderResult } from "../../utils/moderation/pagination.js"

const PER_PAGE = 6

async function renderCasesPage(guildId: string, userId: string, page: number): Promise<PageRenderResult> {
  const all = await ModCase.find({ guildId, userId }).sort({ caseId: -1 }).lean()
  const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE))
  const safe = Math.min(page, totalPages - 1)
  const slice = all.slice(safe * PER_PAGE, (safe + 1) * PER_PAGE)

  const lines = slice.map((c) => {
    const duration = c.duration && c.duration > 0 ? ` • **${c.duration / 1000}s**` : ""
    return (
      `> **${c.caseIdFormatted}** — ${ACTION_EMOJIS[c.action]} **${ACTION_LABELS[c.action]}** — \`${STATUS_LABELS[c.status]}\`${duration}\n` +
      `> ${c.reason} — *${formatDate(c.startedAt)} (<t:${Math.floor(c.startedAt / 1000)}:R>)*`
    )
  })

  const embed = {
    title: " ",
    description:
      `# \`🗂️\` 〃 Cases de <@${userId}> (\`${userId}\`)\n` +
      `> ***Total des cases :** ${all.length}*\n\n` +
      (lines.join("\n\n") || "> *Aucune case enregistrée.*") +
      `\n\n> ***Page :** ${safe + 1}/${totalPages}*`,
    color: 0xf47c0b,
  }

  return { embeds: [embed], totalPages }
}

export default {
  name: "cases",
  description: "Affiche toutes les cases de modération d'un utilisateur.",
  category: "moderation",
  aliases: ["allcases"],
  permissions: ["ManageMessages"],
  usage: "<@utilisateur|id>",

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("cases", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const resolved = await resolveTarget(client, guild, args[0] ?? "", false)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)

    const { embeds, totalPages } = await renderCasesPage(guild.id, resolved.target.id, 0)
    return _message.reply({
      embeds,
      components: [buildNavRow("cases", guild.id, _message.author.id, resolved.target.id, 0, totalPages)],
    })
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handlePageNav(interaction, "cases", renderCasesPage)
  },
}
