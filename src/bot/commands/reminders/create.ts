import type { ChatInputCommandInteraction, Client, Message } from "discord.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { isValidCron } from "../../utils/reminders/cron.js"
import { MAX_LEAD_MS, MIN_LEAD_MS } from "../../utils/reminders/limits.js"
import { clampMessage, newReminderId } from "../../utils/reminders/schema.js"
import { getSettings } from "../../utils/reminders/settings.js"
import { remindersStore } from "../../utils/reminders/storage.js"
import { normalizeWebhookUrl, webhookIdOf } from "../../utils/reminders/webhook.js"
import { parseWhen } from "../../utils/reminders/when.js"
import {
  arm,
  canCreateReminder,
  denyWebhookIfDisabled,
  isDestination,
  isRecurrence,
  parseCreateArgs,
  replyPrivate,
  REMINDER_SLASH_OPTIONS,
  resolveTargetChannel,
} from "./helpers.js"

export default {
  name: "create",
  description: "Créer un rappel.",
  category: "reminders",
  aliases: [],
  permissions: [],
  usage: "create <quand> <message> <dm|salon|webhook> [salon] [url] [recurrence] [cron] [role] [utilisateur]",
  slash: [...REMINDER_SLASH_OPTIONS],
  slashArgs: (interaction: ChatInputCommandInteraction): string[] => {
    const options = interaction.options
    return [
      options.getString("quand") ?? "",
      options.getString("message") ?? "",
      options.getString("destination") ?? "",
      options.getChannel("salon")?.id ?? "",
      options.getString("webhook") ?? "",
      options.getString("recurrence") ?? "none",
      options.getString("cron") ?? "",
      options.getRole("role")?.id ?? "",
      options.getUser("utilisateur")?.id ?? "",
    ]
  },
  async execute(client: Client, message: Message, args: string[]) {
    if (!(await canCreateReminder(client, message))) return
    const guild = requireGuild(message)
    if (!guild) return

    const parsed = parseCreateArgs(args)
    const now = Date.now()

    const nextAt = parseWhen(parsed.quand, now)
    if (nextAt === null) {
      await message.reply({
        embeds: [
          buildModEmbed(
            "cancel",
            "Échéance illisible",
            `> *Je n'ai pas compris \`${parsed.quand.slice(0, 60)}\`.*\n> **Écrivez** une durée (\`45min\`, \`2h30\`, \`1j\`, \`3 semaines\`) ou une date (\`2026-10-05 14:00\`).`
          ),
        ],
      })
      return
    }
    if (nextAt - now < MIN_LEAD_MS) {
      await message.reply({
        embeds: [
          buildModEmbed("cancel", "Trop tard", `> *Un rappel doit partir au moins **${Math.round(MIN_LEAD_MS / 1000)} secondes** dans le futur.*`),
        ],
      })
      return
    }
    if (nextAt - now > MAX_LEAD_MS) {
      await message.reply({
        embeds: [buildModEmbed("cancel", "Trop loin", "> *Un rappel ne peut pas être programmé au-delà d'un an.*")],
      })
      return
    }

    const message_ = clampMessage(parsed.message)
    if (!message_) {
      await message.reply({ embeds: [buildModEmbed("cancel", "Message requis", "> *Indiquez le texte du rappel.*")] })
      return
    }

    if (!isDestination(parsed.destination)) {
      await message.reply({
        embeds: [buildModEmbed("cancel", "Destination inconnue", "> *Choisissez \`dm\`, \`salon\` ou \`webhook\`.*")],
      })
      return
    }

    let channelId: string | null = null
    if (parsed.destination === "salon") {
      const target = parsed.salon || message.channelId
      if (!target) {
        await message.reply({ embeds: [buildModEmbed("cancel", "Salon requis", "> *Précisez le salon cible.*")] })
        return
      }
      const resolved = await resolveTargetChannel(client, guild.id, target)
      if (!resolved.ok) {
        await message.reply({ embeds: [buildModEmbed("cancel", "Salon indisponible", resolved.error)] })
        return
      }
      channelId = resolved.channelId
    }

    let webhookUrl: string | null = null
    if (parsed.destination === "webhook") {
      const settings = await getSettings(guild.id)
      if (denyWebhookIfDisabled(message, settings.allowWebhookDestination)) return
      webhookUrl = normalizeWebhookUrl(parsed.webhook)
      if (!webhookUrl) {
        await message.reply({
          embeds: [
            buildModEmbed(
              "cancel",
              "Webhook invalide",
              "> *Cette URL n'est pas une URL de webhook Discord valide.*\n> *Elle a la forme \`https://discord.com/api/webhooks/<id>/<token>\`.*"
            ),
          ],
        })
        return
      }
    }

    const recurrence = parsed.recurrence ? (isRecurrence(parsed.recurrence) ? parsed.recurrence : "none") : "none"
    let cronExpr: string | null = null
    if (recurrence === "custom") {
      cronExpr = parsed.cron
      if (!isValidCron(cronExpr)) {
        await message.reply({
          embeds: [
            buildModEmbed(
              "cancel",
              "Cron invalide",
              "> *Expression cron refusée.*\n> *Format attendu : \`minute heure jour mois jour-semaine\` (par ex. \`0 9 * * 1-5\`).*"
            ),
          ],
        })
        return
      }
    }

    const mentionRoleIds = parsed.role ? [parsed.role] : []
    const mentionUserIds = parsed.utilisateur ? [parsed.utilisateur] : []

    const record = {
      id: newReminderId(),
      guildId: guild.id,
      authorId: message.author.id,
      message: message_,
      destination: parsed.destination,
      channelId,
      webhookUrl,
      webhookId: webhookIdOf(webhookUrl),
      recurrence,
      cronExpr,
      nextAt,
      paused: false,
      mentionUserIds,
      mentionRoleIds,
      createdAt: now,
      lastError: null,
    }

    const store = remindersStore()
    await store.save(record)
    arm(client, record)

    const lines = [
      `> ${message_}`,
      `> **Quand :** <t:${Math.floor(nextAt / 1000)}:f>`,
      `> **Identifiant :** \`${record.id}\``,
    ]
    if (parsed.destination !== "dm") {
      lines.push("> *Seuls vous voyez ce rappel :*\\_utilisez `/rappel list` pour le gérer ou l'annuler.")
    }
    await replyPrivate(message, {
      embeds: [buildModEmbed("check", "Rappel programmé", lines.join("\n"), "#57F287")],
    })
  },
}
