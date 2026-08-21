import type { AppEmojiName } from "../../shared/botConfig.js"
import { APP_EMOJI_KEYS } from "../../shared/botConfig.js"
import { botRuntime } from "../config.js"

export type { AppEmojiName }
export { APP_EMOJI_KEYS }

export const APP_EMOJI_FALLBACK: Record<AppEmojiName, string> = {
  cancel: "❌",
  add: "➕",
  settings: "⚙️",
  power: "⏻",
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
  return id ? `<:${name}:${id}>` : null
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
