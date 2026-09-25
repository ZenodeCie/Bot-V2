import { parseWebhookURL, type MessageMentionOptions } from "discord.js"

/**
 * Envoi par webhook.
 *
 * Une URL de webhook Discord EST un secret (elle porte le token dans son chemin).
 * Ce module est le seul endroit du module Rappels qui manipule cette URL, et il
 * applique deux règles : jamais de log de la valeur, jamais de log d'un objet
 * d'erreur qui pourrait la contenir.
 */

const WEBHOOK_TIMEOUT_MS = 10_000
const REASON_MAX_LENGTH = 120

export interface WebhookMessagePayload {
  content?: string
  username?: string
  avatarURL?: string
  allowedMentions?: MessageMentionOptions
}

export type WebhookSendResult = { ok: true } | { ok: false; reason: string; code: number | null }

/** Retire toute URL d'un message d'erreur avant de le journaliser. */
export function redact(text: string): string {
  const stripped = text.replace(/https?:\/\/\S+/gi, "<url>")
  return stripped.length > REASON_MAX_LENGTH ? `${stripped.slice(0, REASON_MAX_LENGTH - 1)}…` : stripped
}

/** Retourne l'URL si elle est une URL de webhook Discord valide, sinon `null`. */
export function normalizeWebhookUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  // parseWebhookUrl n'accepte que discord.com (ptb/canary) avec un id et un token
  // de bonne longueur : aucune allocation ni requête réseau.
  return parseWebhookURL(trimmed) ? trimmed : null
}

/** Identifiant public du webhook (non secret), utile pour l'affichage et les logs. */
export function webhookIdOf(raw: unknown): string | null {
  const url = normalizeWebhookUrl(raw)
  if (!url) return null
  return parseWebhookURL(url)?.id ?? null
}

/** Étiquette affichable — jamais l'URL. */
export function webhookLabel(webhookId: string | null): string {
  return webhookId ? `Webhook \`${webhookId}\`` : "Webhook"
}

interface DiscordWebhookErrorBody {
  message?: unknown
  code?: unknown
}

function describeBody(payload: unknown): { reason: string; code: number | null } {
  if (!payload || typeof payload !== "object") return { reason: `HTTP error`, code: null }
  const body = payload as DiscordWebhookErrorBody
  const message = typeof body.message === "string" ? body.message : "HTTP error"
  const code = typeof body.code === "number" ? body.code : null
  return { reason: redact(message), code }
}

export async function postWebhookMessage(url: string, payload: WebhookMessagePayload): Promise<WebhookSendResult> {
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
  } catch (error) {
    // On ne journalise que le nom de l'erreur : le message d'undici peut contenir
    // des détails d'implémentation, et l'objet Error lui-même n'est jamais loggé.
    const name = error instanceof Error ? error.name : "Error"
    return { ok: false, reason: redact(`request failed (${name})`), code: null }
  }

  if (response.ok) return { ok: true }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  const described = describeBody(body)
  return { ok: false, reason: `HTTP ${response.status} — ${described.reason}`, code: described.code }
}
