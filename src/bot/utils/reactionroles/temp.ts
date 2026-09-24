import type { Client, GuildMember } from "discord.js"
import { newGrantId, type TempRoleGrant } from "./schema.js"
import { reactionRoleStore } from "./storage.js"
import { enqueueRoleOp } from "./roleQueue.js"

/**
 * Rôles temporaires : attribution suivie d'un retrait automatique.
 * Timers persistés (Mongo/fichier) → restaurés au reboot, sweep de rattrapage.
 */

const MAX_TIMEOUT = 2_147_483_647
const SWEEP_INTERVAL_MS = 60_000

const timers = new Map<string, NodeJS.Timeout>()

function grantKey(grant: Pick<TempRoleGrant, "guildId" | "userId" | "roleId" | "panelId" | "entryId">): string {
  return `${grant.guildId}:${grant.userId}:${grant.roleId}:${grant.panelId}:${grant.entryId}`
}

async function fetchMember(client: Client, guildId: string, userId: string): Promise<GuildMember | null> {
  const guild = client ? client.guilds.cache.get(guildId) : undefined
  if (!guild) return null
  const cached = guild.members.cache.get(userId)
  if (cached) return cached
  return guild.members.fetch(userId).catch(() => null)
}

export async function addTempGrant(
  client: Client,
  panelId: string,
  entryId: string,
  guildId: string,
  userId: string,
  roleId: string,
  expiresAt: number
): Promise<void> {
  const grant: TempRoleGrant = {
    id: newGrantId(),
    guildId,
    userId,
    roleId,
    panelId,
    entryId,
    grantedAt: Date.now(),
    expiresAt,
  }
  await reactionRoleStore().saveGrant(grant)
  scheduleGrant(client, grant)
}

export function scheduleGrant(client: Client, grant: TempRoleGrant): void {
  const key = grantKey(grant)
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)
  const delay = grant.expiresAt - Date.now()
  const timer = setTimeout(() => {
    timers.delete(key)
    void expireGrant(client, grant).catch((error: unknown) =>
      console.error(`ReactionRoles expire grant failed (${grant.userId} → ${grant.roleId}):`, error)
    )
  }, Math.min(Math.max(delay, 0), MAX_TIMEOUT))
  timers.set(key, timer)
  timer.unref?.()
}

export async function expireGrant(client: Client, grant: TempRoleGrant): Promise<void> {
  const store = reactionRoleStore()
  const claimed = await store.claimGrant(grant.guildId, grant.userId, grant.roleId, grant.panelId, grant.entryId)
  if (!claimed) return

  // Le rôle reste gardé par un autre grant actif (même rôle via une autre entrée) → ne rien retirer.
  const remaining = await store.listGrantsForUser(grant.guildId, grant.userId)
  if (remaining.some((item) => item.roleId === grant.roleId)) return

  const member = await fetchMember(client, grant.guildId, grant.userId)
  if (!member || !member.roles.cache.has(grant.roleId)) return
  await enqueueRoleOp(grant.guildId, () =>
    member.roles.remove(grant.roleId, "ZenodeBots — rôle temporaire expiré").then(() => undefined)
  ).catch(() => undefined)
}

export async function restoreTempGrants(client: Client): Promise<number> {
  const store = reactionRoleStore()
  const grants = await store.listAllGrants().catch(() => [])
  let overdue = 0
  for (const grant of grants) {
    if (grant.expiresAt <= Date.now()) {
      overdue += 1
      void expireGrant(client, grant).catch(() => undefined)
    } else {
      scheduleGrant(client, grant)
    }
  }
  return grants.length
}

export function startTempSweep(client: Client): void {
  const timer = setInterval(() => {
    void sweepTempGrants(client).catch((error: unknown) => console.error("ReactionRoles temp sweep failed:", error))
  }, SWEEP_INTERVAL_MS)
  timer.unref?.()
}

export async function sweepTempGrants(client: Client): Promise<void> {
  const store = reactionRoleStore()
  const grants = await store.listAllGrants().catch(() => [])
  const now = Date.now()
  for (const grant of grants) {
    if (grant.expiresAt <= now) await expireGrant(client, grant).catch(() => undefined)
  }
}

/** Supprime les grants (et timers) d'une entrée pour un membre — retrait manuel du rôle. */
export function cancelTempGrantsForEntry(guildId: string, userId: string, panelId: string, entryId: string): void {
  const prefix = `${guildId}:${userId}:`
  const suffix = `:${panelId}:${entryId}`
  for (const [key, timer] of timers) {
    if (key.startsWith(prefix) && key.endsWith(suffix)) {
      clearTimeout(timer)
      timers.delete(key)
    }
  }
  void reactionRoleStore().deleteGrantsForUserEntry(guildId, userId, panelId, entryId).catch(() => undefined)
}

export function cancelTimersForPanel(guildId: string, panelId: string): void {
  for (const [key, timer] of timers) {
    const parts = key.split(":")
    if (parts.length === 5 && parts[0] === guildId && parts[3] === panelId) {
      clearTimeout(timer)
      timers.delete(key)
    }
  }
}

export function cancelTimersForGuild(guildId: string): void {
  for (const [key, timer] of timers) {
    if (key.startsWith(`${guildId}:`)) {
      clearTimeout(timer)
      timers.delete(key)
    }
  }
}