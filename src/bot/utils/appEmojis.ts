import type { Client } from "discord.js"
import type { AppEmojiName } from "../../shared/botConfig.js"
import { APP_EMOJI_KEYS } from "../../shared/botConfig.js"
import { botRuntime } from "../config.js"

export type { AppEmojiName }
export { APP_EMOJI_KEYS }

/** Noms/type réels des emojis de l'application (casse, renommage, animés). */
const emojiMeta: Partial<Record<AppEmojiName, { name: string; animated: boolean }>> = {}

export const APP_EMOJI_FALLBACK: Record<AppEmojiName, string> = {
  cancel: "❌",
  add: "➕",
  settings: "⚙️",
  power: "⚡",
  pin: "📌",
  people: "👥",
  loop: "🔄",
  file: "📁",
  cog: "⚙️",
  check: "✅",
}

function currentMap(): Partial<Record<AppEmojiName, string>> {
  return botRuntime.raw.application_emojis ?? {}
}

export function appEmojiId(name: AppEmojiName): string | null {
  const id = currentMap()[name]
  return id || null
}

export function appEmoji(name: AppEmojiName): { id: string } | undefined {
  const id = appEmojiId(name)
  return id ? { id } : undefined
}

export function appEmojiTag(name: AppEmojiName): string | null {
  const id = appEmojiId(name)
  if (!id) return null
  const meta = emojiMeta[name]
  return `<${meta?.animated ? "a" : ""}:${meta?.name ?? name}:${id}>`
}

/** Nombre minimum de clés trouvées dans un serveur pour l'accepter comme pack d'emojis. */
const MIN_GUILD_MATCHES = 4

interface EmojiMatch {
  id: string
  name: string
  animated: boolean
}

/**
 * Résout les emojis personnalisés quand la config n'en fournit pas (mode alone :
 * aucun `application_emojis` poussé par le Core).
 * 1. emojis d'application Discord (nom = clé, insensible à la casse) ;
 * 2. sinon pack d'emojis du serveur qui en contient le plus (≥ `MIN_GUILD_MATCHES`),
 *    lu depuis le cache gateway — aucun appel REST supplémentaire.
 * Les IDs déjà connus (config JSON ou `APPLICATION_EMOJIS`) restent prioritaires.
 * Best-effort — échec = fallback unicode.
 */
export async function syncApplicationEmojis(client: Client): Promise<void> {
  const known = currentMap()
  const missing = APP_EMOJI_KEYS.filter((key) => !known[key])
  if (missing.length === 0) return

  const resolved = new Map<AppEmojiName, EmojiMatch>()
  const appEmojis = await fetchApplicationEmojis(client)
  if (appEmojis) {
    for (const [key, emoji] of matchByName(appEmojis, missing)) resolved.set(key, emoji)
  }

  const stillMissing = missing.filter((key) => !resolved.has(key))
  if (stillMissing.length > 0) {
    for (const [key, emoji] of matchGuildPack(client, stillMissing)) resolved.set(key, emoji)
  }

  const resolvedKeys = [...resolved.keys()]
  if (resolvedKeys.length === 0) {
    console.warn(
      `No custom emoji found for [${missing.join(", ")}] (application or guilds) — unicode emojis fallback.`
    )
    return
  }

  const map: Partial<Record<AppEmojiName, string>> = { ...known }
  for (const [key, emoji] of resolved) {
    map[key] = emoji.id
    emojiMeta[key] = { name: emoji.name, animated: emoji.animated }
  }
  botRuntime.raw.application_emojis = map

  const remaining = missing.filter((key) => !resolved.has(key))
  console.log(
    `Custom emojis resolved: ${resolvedKeys.join(", ")}` +
      (remaining.length > 0 ? ` — unicode fallback: ${remaining.join(", ")}` : "")
  )
}

async function fetchApplicationEmojis(client: Client): Promise<Map<string, EmojiMatch> | null> {
  const application = client.application
  if (!application) return null
  try {
    const emojis = await application.emojis.fetch()
    const byName = new Map<string, EmojiMatch>()
    for (const emoji of emojis.values()) {
      byName.set(emoji.name.toLowerCase(), { id: emoji.id, name: emoji.name, animated: Boolean(emoji.animated) })
    }
    return byName
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`Application emojis unavailable (${reason}) — trying guild emoji packs.`)
    return null
  }
}

function matchByName(
  byName: Map<string, EmojiMatch>,
  keys: readonly AppEmojiName[]
): Map<AppEmojiName, EmojiMatch> {
  const out = new Map<AppEmojiName, EmojiMatch>()
  for (const key of keys) {
    const emoji = byName.get(key)
    if (emoji) out.set(key, emoji)
  }
  return out
}

/** Cherche le pack d'emojis le plus complet parmi les serveurs du bot (cache gateway, zéro appel REST). */
function matchGuildPack(client: Client, keys: readonly AppEmojiName[]): Map<AppEmojiName, EmojiMatch> {
  let best = new Map<AppEmojiName, EmojiMatch>()

  for (const guild of client.guilds.cache.values()) {
    const byName = new Map<string, EmojiMatch>()
    for (const emoji of guild.emojis.cache.values()) {
      const name = emoji.name?.toLowerCase()
      if (name) byName.set(name, { id: emoji.id, name: emoji.name ?? name, animated: Boolean(emoji.animated) })
    }
    const matches = matchByName(byName, keys)
    if (matches.size > best.size) best = matches
  }

  return best.size >= MIN_GUILD_MATCHES ? best : new Map()
}

/** Button / select accessory: `{ id }` when known, else unicode (icon-only components need an emoji). */
export function appEmojiOrFallback(name: AppEmojiName): { id: string } | string {
  return appEmoji(name) ?? APP_EMOJI_FALLBACK[name]
}

/** Components V2 accessories want `{ id }` or `{ name }`, not a bare unicode string. */
export function appEmojiComponent(name: AppEmojiName): { id: string } | { name: string } {
  const emoji = appEmojiOrFallback(name)
  return typeof emoji === "string" ? { name: emoji } : emoji
}

export function appEmojiText(name: AppEmojiName): string {
  return appEmojiTag(name) ?? APP_EMOJI_FALLBACK[name]
}

export function appEmojiHeading(name: AppEmojiName, title: string): string {
  const tag = appEmojiTag(name)
  if (tag) return `# ${tag} 〃 ${title}`
  return `# \`${APP_EMOJI_FALLBACK[name]}\` 〃 ${title}`
}
