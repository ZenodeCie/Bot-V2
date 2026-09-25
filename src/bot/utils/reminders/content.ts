import type { MessageMentionOptions } from "discord.js"
import { MAX_MESSAGE_LENGTH } from "./limits.js"
import type { ReminderRecord } from "./schema.js"

/**
 * Composition du message d'un rappel. Fonctions pures : le texte stocké reste
 * propre et les mentions sont ajoutées à l'envoi, ce qui permet de les gérer
 * avec des menus sans réécrire le message.
 */

/**
 * Le résultat est rogné à 2000 caractères, la limite de Discord : le message
 * seul peut déjà l'atteindre et les mentions s'y ajoutent.
 */
export function buildReminderContent(record: ReminderRecord): string {
  const message = record.message.trim()
  const mentions = mentionsOf(record)
  return appendMentions(message, mentions.join(" "))
}

function mentionsOf(record: ReminderRecord): string[] {
  return [
    ...record.mentionUserIds.map((id) => `<@${id}>`),
    ...record.mentionRoleIds.map((id) => `<@&${id}>`),
  ]
}

function appendMentions(body: string, mentions: string): string {
  if (!mentions) return body
  const content = `${body}${body ? "\n" : ""}${mentions}`
  if (content.length <= MAX_MESSAGE_LENGTH) return content
  const room = MAX_MESSAGE_LENGTH - mentions.length - 1
  const kept = room > 1 ? body.slice(0, room - 1).trimEnd() : ""
  return `${kept}…\n${mentions}`.slice(0, MAX_MESSAGE_LENGTH)
}

/** Mentions explicites uniquement : un rappel ne doit jamais notifier un salon entier. */
export function buildAllowedMentions(record: ReminderRecord): MessageMentionOptions {
  return { parse: [], users: record.mentionUserIds, roles: record.mentionRoleIds }
}
