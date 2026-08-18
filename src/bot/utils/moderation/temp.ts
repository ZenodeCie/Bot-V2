import type { Client } from "discord.js"
import { createCase, logModCase, notifyUser, updateCaseDm, type CaseTarget, type DmResult } from "./cases.js"
import { removeMuteRole } from "./mute.js"
import {
  ACTION_LABELS,
  ModCase,
  TemporarySanction,
  type ModAction,
} from "./schema.js"

const MAX_TIMEOUT = 2_147_483_647
const SWEEP_INTERVAL = 60_000

export interface TempSanctionInput {
  guildId: string
  userId: string
  type: "TEMPBAN" | "TEMPMUTE"
  caseId: number
  expiresAt: number
}

export function registerTempSanction(client: Client, input: TempSanctionInput): void {
  void TemporarySanction.create({ ...input, executed: false }).catch((error) =>
    console.error("Failed to persist temp sanction:", error)
  )
  scheduleTempSanction(client, input)
}

export function scheduleTempSanction(client: Client, input: TempSanctionInput): void {
  const delay = input.expiresAt - Date.now()
  if (delay <= 0) {
    void expireTempSanction(client, input).catch((error) =>
      console.error("Failed to expire temp sanction:", error)
    )
    return
  }
  setTimeout(() => {
    void expireTempSanction(client, input).catch((error) =>
      console.error("Failed to expire temp sanction:", error)
    )
  }, Math.min(delay, MAX_TIMEOUT))
}

export async function expireTempSanction(client: Client, input: TempSanctionInput): Promise<void> {
  const reserved = await TemporarySanction.findOneAndUpdate(
    {
      guildId: input.guildId,
      userId: input.userId,
      type: input.type,
      caseId: input.caseId,
      executed: false,
    },
    { $set: { executed: true } }
  )
  if (!reserved) return

  const guild = client.guilds.cache.get(input.guildId)
  if (!guild) return

  const originalCase = await ModCase.findOne({ guildId: input.guildId, caseId: input.caseId }).lean()
  const action: ModAction = input.type === "TEMPBAN" ? "TEMP_BAN_EXPIRED" : "TEMP_MUTE_EXPIRED"
  const target: CaseTarget = originalCase
    ? {
        id: originalCase.userId ?? input.userId,
        username: originalCase.username,
        globalName: originalCase.globalName,
      }
    : { id: input.userId, username: "Utilisateur inconnu", globalName: null }
  const reason = "Expiration automatique de la sanction temporaire."

  try {
    if (input.type === "TEMPBAN") {
      const ban = await guild.bans.fetch(input.userId).catch(() => null)
      if (ban) await guild.bans.remove(input.userId, reason)
    } else {
      const member = await guild.members.fetch(input.userId).catch(() => null)
      if (member) await removeMuteRole(guild, member, reason)
    }

    const c = await createCase({
      guild,
      target,
      moderator: null,
      action,
      reason,
      status: "EXPIRED",
      linkedCaseId: input.caseId,
      metadata: { temporary: true, originalAction: originalCase?.action ?? input.type },
    })

    let dm: DmResult = { status: "sent" }
    try {
      const user = await client.users.fetch(input.userId)
      dm = await notifyUser(user, guild.name, ACTION_LABELS[action], reason, null, c.caseIdFormatted)
    } catch {
      dm = { status: "failed" as const, error: "Utilisateur introuvable." }
    }
    await updateCaseDm(c, dm)
    await logModCase(client, c)
  } catch (error) {
    console.error(`Failed to expire ${input.type} for ${input.userId} in ${input.guildId}:`, error)
    try {
      const failed = await createCase({
        guild,
        target,
        moderator: null,
        action,
        reason: `Échec de l'expiration automatique : ${error instanceof Error ? error.message : String(error)}`,
        status: "FAILED",
        linkedCaseId: input.caseId,
        metadata: { temporary: true, originalAction: originalCase?.action ?? input.type },
      })
      await logModCase(client, failed)
    } catch (inner) {
      console.error("Failed to record temp sanction expiration failure:", inner)
    }
  }
}

export async function initTempSanctions(client: Client): Promise<void> {
  const active = await TemporarySanction.find({ executed: false }).lean()
  let overdue = 0
  for (const doc of active) {
    scheduleTempSanction(client, {
      guildId: doc.guildId,
      userId: doc.userId,
      type: doc.type,
      caseId: doc.caseId,
      expiresAt: doc.expiresAt,
    })
    if (doc.expiresAt <= Date.now()) overdue++
  }
  console.log(
    `Moderation: ${active.length} sanction(s) temporaire(s) restaurée(s) après redémarrage (${overdue} déjà expirée(s)).`
  )
}

export function startTempSweep(client: Client): void {
  setInterval(() => {
    void sweepExpiredTempSanctions(client).catch((error) =>
      console.error("Temp sanction sweep failed:", error)
    )
  }, SWEEP_INTERVAL)
}

export async function sweepExpiredTempSanctions(client: Client): Promise<void> {
  const expired = await TemporarySanction.find({ executed: false, expiresAt: { $lte: Date.now() } }).lean()
  for (const doc of expired) {
    await expireTempSanction(client, {
      guildId: doc.guildId,
      userId: doc.userId,
      type: doc.type,
      caseId: doc.caseId,
      expiresAt: doc.expiresAt,
    }).catch((error) => console.error(error))
  }
}
