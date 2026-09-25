import {
  ApplicationCommandOptionType,
  MessageFlags,
  type Client,
  type Message,
  type MessageCreateOptions,
} from "discord.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { buildReminderContent } from "../../utils/reminders/content.js"
import {
  MAX_MENTIONS_PER_KIND,
  RECURRENCE_LABELS,
  clampMessage,
  type ReminderDestination,
  type ReminderRecord,
  type ReminderRecurrence,
} from "../../utils/reminders/schema.js"
import { getSettings } from "../../utils/reminders/settings.js"
import { remindersStore } from "../../utils/reminders/storage.js"
import { webhookLabel } from "../../utils/reminders/webhook.js"
import { scheduleReminder } from "../../utils/remindersEngine.js"

/**
 * Communs aux commandes `/rappel` : contrôle de quota, lecture des options et
 * rendu. Les deux modes sont servis — l'exécution par message (préfixe) reçoit
 * des arguments texte, le slash lit ses options via `slashArgs`.
 */

export const RECURRENCE_CHOICES = [
  { name: "Une fois", value: "none" },
  { name: "Quotidien", value: "daily" },
  { name: "Hebdomadaire", value: "weekly" },
  { name: "Mensuel", value: "monthly" },
  { name: "Cron (expression)", value: "custom" },
]

export const DESTINATION_CHOICES = [
  { name: "Message privé", value: "dm" },
  { name: "Salon", value: "salon" },
  { name: "Webhook", value: "webhook" },
]

export const REMINDER_SLASH_OPTIONS = [
  { name: "quand", description: "Échéance : 2h30, 45min, 1j, 3 semaines ou 2026-10-05 14:00", type: ApplicationCommandOptionType.String, required: true },
  { name: "message", description: "Texte du rappel", type: ApplicationCommandOptionType.String, required: true },
  { name: "destination", description: "Où envoyer le rappel", type: ApplicationCommandOptionType.String, required: true, choices: DESTINATION_CHOICES },
  { name: "salon", description: "Salon cible (destination salon)", type: ApplicationCommandOptionType.Channel, required: false },
  { name: "webhook", description: "URL du webhook (destination webhook)", type: ApplicationCommandOptionType.String, required: false },
  { name: "recurrence", description: "Récurrence", type: ApplicationCommandOptionType.String, required: false, choices: RECURRENCE_CHOICES },
  { name: "cron", description: "Expression cron, si recurrence = Cron", type: ApplicationCommandOptionType.String, required: false },
  { name: "role", description: "Rôle à mentionner", type: ApplicationCommandOptionType.Role, required: false },
  { name: "utilisateur", description: "Utilisateur à mentionner", type: ApplicationCommandOptionType.User, required: false },
] as const

export function isDestination(value: string): value is ReminderDestination {
  return (["dm", "salon", "webhook"] as const).includes(value as ReminderDestination)
}

/**
 * Réponse privée. En slash, `asCommandMessage` relaie vers `interaction.reply`
 * qui accepte `flags` ; en invocation par préfixe le drapeau est ignoré et le
 * message est public — son contenu ne contient aucun secret (l'URL du webhook
 * n'est jamais réaffichée).
 */
export function replyPrivate(message: Message, payload: Omit<MessageCreateOptions, "flags">): Promise<unknown> {
  return message.reply({ ...payload, flags: MessageFlags.Ephemeral } as unknown as MessageCreateOptions)
}

export function isRecurrence(value: string): value is ReminderRecurrence {
  return (["none", "daily", "weekly", "monthly", "custom"] as const).includes(value as ReminderRecurrence)
}

export interface ParsedSlashArgs {
  quand: string
  message: string
  destination: string
  salon: string
  webhook: string
  recurrence: string
  cron: string
  role: string
  utilisateur: string
}

/** Les slash remontent déjà des IDs ; le préfixe passe par des jetons bruts. */
export function parseCreateArgs(args: string[]): ParsedSlashArgs {
  return {
    quand: args[0]?.trim() ?? "",
    message: args[1]?.trim() ?? "",
    destination: args[2]?.trim().toLowerCase() ?? "",
    salon: args[3]?.trim() ?? "",
    webhook: args[4]?.trim() ?? "",
    recurrence: args[5]?.trim().toLowerCase() ?? "none",
    cron: args[6]?.trim() ?? "",
    role: args[7]?.trim() ?? "",
    utilisateur: args[8]?.trim() ?? "",
  }
}

export function denyIfGuildForbidden(message: Message, isAdmin: boolean, settings: { adminOnly: boolean }): boolean {
  if (!isAdmin && settings.adminOnly) {
    void message.reply({
      embeds: [
        buildModEmbed(
          "cancel",
          "Réservé aux administrateurs",
          "> *Seuls les administrateurs peuvent créer des rappels sur ce salon.*"
        ),
      ],
    })
    return true
  }
  return false
}

export async function quotaRemaining(guildId: string, userId: string): Promise<number> {
  const [settings, used] = await Promise.all([
    getSettings(guildId),
    remindersStore().countForUser(guildId, userId),
  ])
  return Math.max(0, settings.maxRemindersPerUser - used)
}

export async function canCreateReminder(client: Client, message: Message): Promise<boolean> {
  const guild = requireGuild(message)
  if (!guild) return false
  const settings = await getSettings(guild.id)
  const isAdmin = Boolean(message.member?.permissions.has("Administrator"))
  if (denyIfGuildForbidden(message, isAdmin, settings)) return false

  if (await quotaRemaining(guild.id, message.author.id) <= 0) {
    await message.reply({
      embeds: [
        buildModEmbed(
          "cancel",
          "Quota atteint",
          `> *Vous avez atteint la limite de **${settings.maxRemindersPerUser}** rappel(s) sur ce salon.*\n> *Supprimez-en un avec \`/rappel list\`.*`
        ),
      ],
    })
    return false
  }
  return true
}

/** Un salon peut interdire la destination webhook (réglages du module). */
export function denyWebhookIfDisabled(message: Message, allowed: boolean): boolean {
  if (allowed) return false
  void message.reply({
    embeds: [
      buildModEmbed(
        "cancel",
        "Webhook désactivé",
        "> *La destination webhook est désactivée sur ce salon.*\n> *Un administrateur peut la réactiver depuis `/config`.*"
      ),
    ],
  })
  return true
}

/** Résout un salon cible en refusant ce qui n'est pas envoyable. */
export async function resolveTargetChannel(
  client: Client,
  guildId: string,
  channelId: string
): Promise<{ ok: true; channelId: string } | { ok: false; error: string }> {
  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel) return { ok: false, error: "> *Salon introuvable.*" }
  if (!channel.isTextBased() || channel.isDMBased() || !channel.isSendable()) {
    return { ok: false, error: "> *Ce salon ne permet pas l'envoi de messages.*" }
  }
  if (channel.guildId !== guildId) return { ok: false, error: "> *Ce salon n'appartient pas à ce serveur.*" }
  return { ok: true, channelId: channel.id }
}

function whenLabel(record: ReminderRecord): string {
  return `<t:${Math.floor(record.nextAt / 1000)}:f>`
}

export function buildReminderEmbed(record: ReminderRecord, title = "Rappel"): ReturnType<typeof buildModEmbed> {
  const lines = [
    `> ${buildReminderContent(record) || "*(aucun message)*"}`,
    `> **Quand :** ${whenLabel(record)}`,
    `> **Récurrence :** ${record.recurrence === "custom" ? `cron \`${record.cronExpr ?? ""}\`` : RECURRENCE_LABELS[record.recurrence]}`,
    `> **Destination :** ${
      record.destination === "dm"
        ? "message privé"
        : record.destination === "salon"
          ? `<#${record.channelId}>`
          : webhookLabel(record.webhookId)
    }`,
    `> **Statut :** ${record.paused ? "*en pause*" : "**actif**"}`,
    `> **Identifiant :** \`${record.id}\``,
  ]
  if (record.lastError) lines.push(`> **Dernière erreur :** ${record.lastError}`)
  return buildModEmbed("pin", title, lines.join("\n"), record.paused ? "#F4E00B" : "#57F287")
}

export function countMentions(record: ReminderRecord): string {
  const users = record.mentionUserIds.length
  const roles = record.mentionRoleIds.length
  const cap = MAX_MENTIONS_PER_KIND
  const label = (n: number, kind: string) => `${n}/${cap} ${kind}`
  return `${label(users, "utilisateur(s)")} · ${label(roles, "rôle(s)")}`
}

/** Arme le timer après création ou édition. */
export function arm(client: Client, record: ReminderRecord): void {
  scheduleReminder(client, record)
}
