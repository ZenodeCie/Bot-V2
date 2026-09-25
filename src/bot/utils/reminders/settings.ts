import { remindersStore } from "./storage.js"
import {
  applyOverride,
  botDefaults,
  normalizeOverride,
  type RemindersSettings,
  type RemindersSettingsOverride,
} from "./schema.js"

/**
 * Résolution des réglages du module : surcharge par salon > défauts du bot
 * (`configs/{bot_id}.json`) > valeurs codées en dur.
 */

const SETTINGS_CACHE_TTL = 5_000
const cache = new Map<string, { settings: RemindersSettings; ts: number }>()

export function invalidateSettings(guildId?: string): void {
  if (!guildId) {
    cache.clear()
    return
  }
  cache.delete(guildId)
}

export async function getSettings(guildId: string): Promise<RemindersSettings> {
  const hit = cache.get(guildId)
  if (hit && Date.now() - hit.ts < SETTINGS_CACHE_TTL) return hit.settings

  const override = await remindersStore()
    .getGuildOverride(guildId)
    .catch((error: unknown) => {
      console.error(`Rappels: lecture de la surcharge salon ${guildId} impossible:`, error)
      return {}
    })
  const settings = applyOverride(botDefaults(), override)
  cache.set(guildId, { settings, ts: Date.now() })
  return settings
}

export async function getOverride(guildId: string): Promise<RemindersSettingsOverride> {
  return remindersStore()
    .getGuildOverride(guildId)
    .catch((error: unknown) => {
      console.error(`Rappels: lecture de la surcharge salon ${guildId} impossible:`, error)
      return {}
    })
}

export async function updateOverride(guildId: string, patch: RemindersSettingsOverride): Promise<RemindersSettings> {
  const current = await getOverride(guildId)
  await remindersStore().saveGuildOverride(guildId, normalizeOverride({ ...current, ...patch }))
  invalidateSettings(guildId)
  return getSettings(guildId)
}

/** Réinitialise la surcharge du salon : le salon retombe sur les défauts du bot. */
export async function resetOverride(guildId: string): Promise<RemindersSettings> {
  await remindersStore().saveGuildOverride(guildId, {})
  invalidateSettings(guildId)
  return getSettings(guildId)
}
