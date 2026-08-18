import type { Client, Message } from "discord.js"
import { ApplicationCommandOptionType } from "discord.js"
import { formatDate, logCommandUse, parseCaseIdArg, replyError, requireGuild } from "../../utils/moderation/helpers.js"
import { getCaseByNumber, getLinkedNextCase } from "../../utils/moderation/cases.js"
import {
  ACTION_EMOJIS,
  ACTION_LABELS,
  STATUS_LABELS,
  formatCaseId,
  metaNumber,
  metaString,
} from "../../utils/moderation/schema.js"

export default {
  name: "case",
  description: "Affiche le détail d'une case de modération.",
  category: "moderation",
  aliases: ["cas", "caseinfo"],
  permissions: ["ManageMessages"],
  usage: "<id|CASE-000001>",
  slash: [
    { name: "id", description: "ID de la case", type: ApplicationCommandOptionType.String, required: true },
  ],

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("case", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const caseId = parseCaseIdArg(args[0] ?? "")
    if (caseId === null) {
      return replyError(_message, "400 Bad Request", "> *ID de case invalide. Exemples : `125`, `#125`, `CASE-000125`.*")
    }

    const c = await getCaseByNumber(guild.id, caseId)
    if (!c) {
      return replyError(_message, "404 Not Found", `> *Aucune case **${formatCaseId(caseId)}** trouvée dans ce serveur.*`)
    }

    const next = await getLinkedNextCase(guild.id, c.caseId)
    const previous = c.linkedCaseId ? await getCaseByNumber(guild.id, c.linkedCaseId) : null

    const lines: string[] = [
      `> ***Action :** ${ACTION_EMOJIS[c.action]} ${ACTION_LABELS[c.action]}*`,
      `> ***Utilisateur :** ${c.username} (\`${c.userId ?? "—"}\`)*`,
      `> ***Modérateur :** ${c.moderatorUsername} (\`${c.moderatorId ?? "—"}\`)*`,
      `> ***Raison :** ${c.reason}*`,
      `> ***Durée :** ${c.duration ? `${c.duration / 1000}s` : "Permanente"}*`,
      `> ***Début :** ${formatDate(c.startedAt)} (<t:${Math.floor(c.startedAt / 1000)}:R>)*`,
    ]
    if (c.endAt) {
      lines.push(`> ***Expiration :** ${formatDate(c.endAt)} (<t:${Math.floor(c.endAt / 1000)}:R>)*`)
    }
    if (c.channelName) {
      lines.push(`> ***Salon :** ${c.channelName} (\`${c.channelId}\`)*`)
    }
    if (previous) {
      lines.push(`> ***Case précédente :** ${previous.caseIdFormatted} — ${ACTION_LABELS[previous.action]}*`)
    }
    if (next) {
      lines.push(`> ***Case suivante :** ${next.caseIdFormatted} — ${ACTION_LABELS[next.action]}*`)
    }
    lines.push(`> ***Statut :** ${STATUS_LABELS[c.status]}*`)
    if (c.error) {
      lines.push(`> ***Erreur :** \`${c.error}\`*`)
    }
    if (c.dmStatus !== "none") {
      lines.push(`> ***DM :** ${c.dmStatus === "sent" ? "Envoyé" : `Échec (${c.dmError ?? "inconnu"})`}*`)
    }
    if (c.action === "CLEAR" || c.action === "PURGE") {
      lines.push(
        `> ***Messages :** demandé ${metaNumber(c, "requested")} • supprimé ${metaNumber(c, "deleted")}${
          metaNumber(c, "failed") > 0 ? ` • échec ${metaNumber(c, "failed")}` : ""
        }*`
      )
    }
    if (c.action === "SLOWMODE") {
      lines.push(
        `> ***Slowmode :** ${metaNumber(c, "oldSlowmode")}s → ${metaNumber(c, "newSlowmode")}s*`
      )
    }
    if (c.action === "WARNINGS_CLEARED") {
      lines.push(`> ***Avertissements révoqués :** ${metaNumber(c, "count")}*`)
    }
    if (c.action === "LOCK") {
      lines.push(`> ***Salon verrouillé :** <#${c.channelId ?? ""}>*`)
    }
    if (c.action === "WARN" || c.action === "UNWARN") {
      const warningId = metaNumber(c, "warningId")
      if (warningId > 0) lines.push(`> ***Avertissement :** ${metaString(c, "originalWarningIdFormatted", `WARN-${String(warningId).padStart(4, "0")}`)}*`)
    }

    return _message.reply({
      embeds: [
        {
          title: " ",
          description: `# \`🔍\` 〃 ${c.caseIdFormatted}\n\n${lines.join("\n")}`,
          color: 0xf47c0b,
          footer: { text: `Guild : ${c.guildName}` },
        },
      ],
    })
  },
}
