import { type Client, type Message } from "discord.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { remindersStore } from "../../utils/reminders/storage.js"
import { quotaRemaining, replyPrivate } from "./helpers.js"

const RECURRENCE_LABELS_SHORT: Record<string, string> = {
  none: "une fois",
  daily: "quotidien",
  weekly: "hebdo",
  monthly: "mensuel",
  custom: "cron",
}

export default {
  name: "list",
  description: "Lister vos rappels et leur identifiant d'annulation.",
  category: "reminders",
  aliases: [],
  permissions: [],
  usage: "list",
  async execute(client: Client, message: Message) {
    const guild = requireGuild(message)
    if (!guild) return

    const mine = await remindersStore().listForUser(guild.id, message.author.id)
    if (mine.length === 0) {
      await replyPrivate(message, {
        embeds: [
          buildModEmbed("pin", "Vos rappels", "> *Vous n'avez aucun rappel sur ce serveur.*\n> *Créez-en un avec `/rappel create`.*"),
        ],
      })
      return
    }

    const remaining = await quotaRemaining(guild.id, message.author.id)
    const lines = mine.map(
      (record) =>
        `> **\`${record.id}\`** — <t:${Math.floor(record.nextAt / 1000)}:f> — ${RECURRENCE_LABELS_SHORT[record.recurrence] ?? record.recurrence}${record.paused ? " — *en pause*" : ""}\n> ${record.message.slice(0, 120) || "*(vide)*"}`
    )
    lines.push(`> *Quota :* ${mine.length} / ${mine.length + remaining} rappel(s).`)

    await replyPrivate(message, {
      embeds: [buildModEmbed("pin", `Vos rappels (${mine.length})`, lines.join("\n"), "#57F287")],
    })
  },
}
