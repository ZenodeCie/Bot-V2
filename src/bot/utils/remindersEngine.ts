import type { Client, GuildTextBasedChannel, MessageCreateOptions } from "discord.js"
import { buildAllowedMentions, buildReminderContent } from "./reminders/content.js"
import { computeNextAt } from "./reminders/recurrence.js"
import { normalizeWebhookUrl, postWebhookMessage, webhookLabel } from "./reminders/webhook.js"
import type { ReminderRecord } from "./reminders/schema.js"
import { remindersStore } from "./reminders/storage.js"

/**
 * Moteur du module Rappels.
 *
 * Un timer `setTimeout` par rappel, plus un balayage de sécurité qui rattrape ce
 * qui aurait été perdu (process figé, reprise après une panne, horloge décalée).
 * Les deux chemins passent par `fireReminder`, qui garde un verrou en cours
 * d'envoi pour qu'un rappel ne parte jamais deux fois.
 *
 * L'envoi est un simple `channel.send` / `user.send` : aucun client Discord
 * supplémentaire n'est créé, ce qui respecte la contrainte « 1 bot = 1 process ».
 */

const MAX_TIMEOUT_MS = 2_147_483_647
const SWEEP_INTERVAL_MS = 30_000
/** Nombre de relances d'un timer qui a Wyatt réveillé avant l'heure. */
const MAX_TIMER_WAKEUPS = 3

const timers = new Map<string, NodeJS.Timeout>()
const inFlight = new Set<string>()
let sweepStarted = false

function reminderKey(guildId: string, id: string): string {
  return `${guildId}:${id}`
}

function clearTimer(key: string): void {
  const timer = timers.get(key)
  if (!timer) return
  clearTimeout(timer)
  timers.delete(key)
}

/** Le texte stocké reste propre : les mentions sont composées à l'envoi. */
type DeliveryResult = { ok: true } | { ok: false; reason: string }

async function resolveGuildChannel(client: Client, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !channel.isSendable()) return null
  return channel
}

async function deliver(client: Client, record: ReminderRecord): Promise<DeliveryResult> {
  const content = buildReminderContent(record)
  const allowedMentions = buildAllowedMentions(record)

  if (record.destination === "dm") {
    const author = await client.users.fetch(record.authorId).catch(() => null)
    if (!author) return { ok: false, reason: "auteur introuvable" }
    const sent = await author.send({ content, allowedMentions } as MessageCreateOptions).catch(() => null)
    return sent ? { ok: true } : { ok: false, reason: "messages privés bloqués" }
  }

  if (record.destination === "salon") {
    if (!record.channelId) return { ok: false, reason: "salon cible manquant" }
    const channel = await resolveGuildChannel(client, record.channelId)
    if (!channel) return { ok: false, reason: "salon inaccessible" }
    const sent = await channel.send({ content, allowedMentions } as MessageCreateOptions).catch(() => null)
    return sent ? { ok: true } : { ok: false, reason: "envoi impossible" }
  }

  const url = normalizeWebhookUrl(record.webhookUrl)
  if (!url) return { ok: false, reason: "webhook invalide" }
  const result = await postWebhookMessage(url, { content, allowedMentions })
  return result.ok ? { ok: true } : { ok: false, reason: result.reason }
}

/**
 * Prévenir l'auteur en privé que son rappel n'a pas pu partir. Sans effet si la
 * destination était déjà un DM, et sans jamais quoting l'URL du webhook.
 */
async function notifyFailure(client: Client, record: ReminderRecord, reason: string): Promise<void> {
  if (record.destination === "dm") return
  const author = await client.users.fetch(record.authorId).catch(() => null)
  if (!author) return
  const where = record.destination === "salon" ? "le salon" : webhookLabel(record.webhookId)
  const verdict =
    record.recurrence === "none"
      ? "Le rappel a été **supprimé**."
      : "Le rappel récurrent a été **mis en pause**."
  await author
    .send({
      content: `> ⚠️ Votre rappel n'a pas pu être envoyé vers ${where} (${reason}).\n> ${verdict}\n> La commande /rappel list permet de le gérer.`,
      allowedMentions: { parse: [] },
    })
    .catch(() => null)
}

export async function fireReminder(client: Client, guildId: string, id: string): Promise<void> {
  const key = reminderKey(guildId, id)
  if (inFlight.has(key)) return
  inFlight.add(key)
  const store = remindersStore()

  try {
    // Relu à chaque tir : le rappel a pu être supprimé, modifié ou mis en pause
    // entre l'armement du timer et son déclenchement.
    const record = await store.get(guildId, id)
    if (!record) {
      clearTimer(key)
      return
    }
    if (record.paused) {
      clearTimer(key)
      return
    }
    if (record.nextAt > Date.now()) {
      scheduleReminder(client, record)
      return
    }

    const result = await deliver(client, record)
    if (result.ok) {
      await onDelivered(client, store, record)
      return
    }
    await onFailed(client, store, record, result.reason)
  } catch (error) {
    // Le journal ne reçoit que le message : rien ici ne contient de secret, le
    // rappel n'est ni supprimé ni mis en pause, il retentira au prochain balayage.
    console.error(`Rappels: tir du rappel ${key} en échec:`, error instanceof Error ? error.message : String(error))
  } finally {
    inFlight.delete(key)
  }
}

async function onDelivered(
  client: Client,
  store: ReturnType<typeof remindersStore>,
  record: ReminderRecord
): Promise<void> {
  const key = reminderKey(record.guildId, record.id)
  if (record.recurrence === "none") {
    clearTimer(key)
    await store.remove(record.guildId, record.id)
    return
  }

  const nextAt = computeNextAt(record, record.nextAt)
  if (nextAt === null) {
    clearTimer(key)
    await store.save({ ...record, paused: true, lastError: "plus aucune occurrence future" })
    console.warn(`Rappels: ${key} mis en pause, la récurrence n'a plus d'occurrence future.`)
    return
  }

  await store.save({ ...record, nextAt, paused: false, lastError: null })
  scheduleReminderAt(client, record.guildId, record.id, nextAt)
}

async function onFailed(
  client: Client,
  store: ReturnType<typeof remindersStore>,
  record: ReminderRecord,
  reason: string
): Promise<void> {
  const key = reminderKey(record.guildId, record.id)
  clearTimer(key)
  console.error(`Rappels: ${key} non envoyé (${reason}).`)

  await notifyFailure(client, record, reason)
  if (record.recurrence === "none") await store.remove(record.guildId, record.id)
  else await store.save({ ...record, paused: true, lastError: reason })
}

/**
 * Arme le timer d'un rappel. Réveillé trop tôt (horloge système, `setTimeout`
 * approximatif sur un long délai), il se reprogramme au lieu de tirer.
 */
function scheduleReminderAt(client: Client, guildId: string, id: string, nextAt: number, wakeups = 0): void {
  const key = reminderKey(guildId, id)
  clearTimer(key)

  const delay = nextAt - Date.now()
  if (delay <= 0) {
    void fireReminder(client, guildId, id)
    return
  }
  if (wakeups >= MAX_TIMER_WAKEUPS) {
    // Trop de réveils anticipés : le balayage prendra le relais.
    return
  }

  const timer = setTimeout(() => {
    timers.delete(key)
    if (Date.now() < nextAt) {
      scheduleReminderAt(client, guildId, id, nextAt, wakeups + 1)
      return
    }
    void fireReminder(client, guildId, id)
  }, Math.min(delay, MAX_TIMEOUT_MS))
  // Un timer ne doit pas maintenir le process bot vivant à lui seul.
  timer.unref?.()
  timers.set(key, timer)
}

/** Arme (ou reprogramme) le timer d'un rappel déjà persisté. */
export function scheduleReminder(client: Client, record: ReminderRecord): void {
  if (record.paused) {
    clearTimer(reminderKey(record.guildId, record.id))
    return
  }
  scheduleReminderAt(client, record.guildId, record.id, record.nextAt)
}

/** Relit le timer d'un rappel depuis le store (après création, édition, reprise). */
export async function rescheduleReminder(client: Client, guildId: string, id: string): Promise<void> {
  const key = reminderKey(guildId, id)
  const record = await remindersStore()
    .get(guildId, id)
    .catch(() => null)
  if (!record) {
    clearTimer(key)
    return
  }
  scheduleReminder(client, record)
}

/** Retire les timers d'un salon sans toucher au store (utilisé à la suppression). */
export function clearGuildTimers(guildId: string): void {
  for (const key of [...timers.keys()]) {
    if (key.startsWith(`${guildId}:`)) clearTimer(key)
  }
}

export function stopReminders(): void {
  for (const key of [...timers.keys()]) clearTimer(key)
  sweepStarted = false
}

export async function initReminders(client: Client): Promise<void> {
  const records = await remindersStore().listAll()
  let armed = 0
  let overdue = 0
  for (const record of records) {
    if (record.paused) continue
    scheduleReminder(client, record)
    armed++
    if (record.nextAt <= Date.now()) overdue++
  }
  console.log(`Rappels: ${armed} rappel(s) restauré(s) après redémarrage (${overdue} déjà dû(s)).`)
}

export function startRemindersSweep(client: Client): void {
  if (sweepStarted) return
  sweepStarted = true
  const sweep = setInterval(() => {
    void sweepDueReminders(client).catch((error) =>
      console.error("Rappels: balayage en échec:", error instanceof Error ? error.message : String(error))
    )
  }, SWEEP_INTERVAL_MS)
  sweep.unref?.()
}

/**
 * Filet de sécurité : rattrape les rappels dont le timer a été perdu. Le verrou
 * `inFlight` fait qu'un rappel déjà en cours d'envoi est ignoré.
 */
export async function sweepDueReminders(client: Client): Promise<void> {
  const now = Date.now()
  const due = (await remindersStore().listAll()).filter((record) => !record.paused && record.nextAt <= now)
  for (const record of due) {
    await fireReminder(client, record.guildId, record.id).catch((error) =>
      console.error(
        `Rappels: balayage du rappel ${reminderKey(record.guildId, record.id)} en échec:`,
        error instanceof Error ? error.message : String(error)
      )
    )
  }
}
