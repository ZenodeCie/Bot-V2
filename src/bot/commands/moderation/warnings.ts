import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType } from "discord.js"
import {
  formatDate,
  logCommandUse,
  replyError,
  requireGuild,
  resolveTarget,
} from "../../utils/moderation/helpers.js"
import { Warning } from "../../utils/moderation/schema.js"
import {
  buildNavRow,
  handlePageNav,
  type PageRenderResult,
} from "../../utils/moderation/pagination.js"
import { appEmojiHeading } from "../../utils/appEmojis.js"

const PER_PAGE = 5

async function renderWarningsPage(guildId: string, userId: string, page: number): Promise<PageRenderResult> {
  const all = await Warning.find({ guildId, userId }).sort({ warningId: -1 }).lean()
  const active = all.filter((w) => !w.revoked).length
  const revoked = all.length - active
  const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE))
  const safe = Math.min(page, totalPages - 1)
  const slice = all.slice(safe * PER_PAGE, (safe + 1) * PER_PAGE)
  const username = all[0]?.username ?? userId

  const lines = slice.map((w) => {
    const status = w.revoked
      ? `**Révoqué** — par <@${w.revokedBy ?? "inconnu"}> le ${formatDate(w.revokedAt ?? w.timestamp)}`
      : "**Actif**"
    return (
      `### ${w.warningIdFormatted} — ${status}\n` +
      `> ***Raison :** ${w.reason}*\n` +
      `> ***Modérateur :** <@${w.moderatorId}>*\n` +
      `> ***Date :** ${formatDate(w.timestamp)} (<t:${Math.floor(w.timestamp / 1000)}:R>)*\n` +
      `> ***Case :** ${w.caseIdFormatted}*` +
      (w.revoked ? `\n> ***Raison de révocation :** ${w.revokeReason ?? "—"}*` : "")
    )
  })

  const embed = {
    title: " ",
    description:
      `${appEmojiHeading("file", `Avertissements de ${username} (\`${userId}\`)`)}\n` +
      `> ***Total :** ${all.length} • Actifs : ${active} • Révoqués : ${revoked}*\n\n` +
      (lines.join("\n\n") || "> *Aucun avertissement.*") +
      `\n\n> ***Page :** ${safe + 1}/${totalPages}*`,
    color: 0xf4e00b,
  }

  return { embeds: [embed], totalPages }
}

export default {
  name: "warnings",
  description: "Affiche tous les avertissements d'un utilisateur.",
  category: "moderation",
  aliases: ["warns", "avertissements"],
  permissions: ["ManageMessages"],
  usage: "<@utilisateur|id>",
  slash: [
    { name: "utilisateur", description: "Utilisateur", type: ApplicationCommandOptionType.User, required: true },
  ],

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("warnings", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const resolved = await resolveTarget(client, guild, args[0] ?? "", false)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)

    const { embeds, totalPages } = await renderWarningsPage(guild.id, resolved.target.id, 0)
    return _message.reply({
      embeds,
      components: [buildNavRow("warnings", guild.id, _message.author.id, resolved.target.id, 0, totalPages)],
    })
  },

  async handleInteraction(client: Client, interaction: import("discord.js").Interaction): Promise<boolean> {
    return handlePageNav(interaction, "warnings", renderWarningsPage)
  },
}
