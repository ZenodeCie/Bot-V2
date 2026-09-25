/**
 * Bornes et libellés du module Rappels.
 *
 * Ce fichier n'importe rien : `when.ts`, `cron.ts` et `recurrence.ts` restent
 * des fonctions pures, sans dépendance au `.env` ni à la configuration du bot.
 */

export const MAX_MESSAGE_LENGTH = 2000
export const MAX_MENTIONS_PER_KIND = 10
export const MIN_LEAD_MS = 30_000
export const MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000
export const MIN_REMINDERS_PER_USER = 1
export const MAX_REMINDERS_PER_USER = 500
export const DEFAULT_REMINDERS_PER_USER = 10

export const REMINDER_DESTINATIONS = ["dm", "salon", "webhook"] as const
export type ReminderDestination = (typeof REMINDER_DESTINATIONS)[number]

export const REMINDER_RECURRENCES = ["none", "daily", "weekly", "monthly", "custom"] as const
export type ReminderRecurrence = (typeof REMINDER_RECURRENCES)[number]

export const RECURRENCE_LABELS: Record<ReminderRecurrence, string> = {
  none: "Une fois",
  daily: "Quotidien",
  weekly: "Hebdomadaire",
  monthly: "Mensuel",
  custom: "Cron",
}

export const DESTINATION_LABELS: Record<ReminderDestination, string> = {
  dm: "Message privé",
  salon: "Salon",
  webhook: "Webhook",
}
