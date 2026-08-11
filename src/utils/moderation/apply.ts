import { PermissionFlagsBits, type Client, type Guild, type PermissionResolvable } from "discord.js"
import {
  createCase,
  findActiveCase,
  logModCase,
  notifyUser,
  updateCaseDm,
  type CaseActor,
  type CaseTarget,
  type DmResult,
} from "./cases.js"
import { checkModerationTarget } from "./helpers.js"
import { addMuteRole } from "./mute.js"
import { ACTION_LABELS, Warning, formatWarningId, nextWarningId, type ModAction, type ModCaseDoc } from "./schema.js"
import { registerTempSanction } from "./temp.js"

export const CARD_ACTIONS = ["WARN", "KICK", "BAN", "TIMEOUT", "MUTE", "TEMPBAN", "TEMPMUTE"] as const
export type CardAction = (typeof CARD_ACTIONS)[number]

export const CARD_ACTION_LABELS: Record<CardAction, string> = {
  WARN: "Avertir",
  KICK: "Expulser",
  BAN: "Bannir",
  TIMEOUT: "Exclure temporairement",
  MUTE: "Muter",
  TEMPBAN: "Bannir temporairement",
  TEMPMUTE: "Muter temporairement",
}

export const ACTION_PERMISSIONS: Record<CardAction, PermissionResolvable> = {
  WARN: PermissionFlagsBits.ManageMessages,
  KICK: PermissionFlagsBits.KickMembers,
  BAN: PermissionFlagsBits.BanMembers,
  TIMEOUT: PermissionFlagsBits.ModerateMembers,
  MUTE: PermissionFlagsBits.ModerateMembers,
  TEMPBAN: PermissionFlagsBits.BanMembers,
  TEMPMUTE: PermissionFlagsBits.ModerateMembers,
}

export const ACTION_REQUIRES_DURATION: Record<CardAction, boolean> = {
  WARN: false,
  KICK: false,
  BAN: false,
  TIMEOUT: true,
  MUTE: false,
  TEMPBAN: true,
  TEMPMUTE: true,
}

export const DURATION_LIMITS: Record<CardAction, { min: number; max: number }> = {
  WARN: { min: 0, max: 0 },
  KICK: { min: 0, max: 0 },
  BAN: { min: 0, max: 0 },
  TIMEOUT: { min: 10_000, max: 28 * 86_400_000 },
  MUTE: { min: 0, max: 0 },
  TEMPBAN: { min: 30_000, max: 3650 * 86_400_000 },
  TEMPMUTE: { min: 30_000, max: 365 * 86_400_000 },
}

export function validateCardDuration(action: CardAction, duration: number): string | null {
  const limits = DURATION_LIMITS[action]
  if (duration < limits.min) {
    return `La durée minimale est de ${Math.round(limits.min / 1000)} secondes pour cette action.`
  }
  if (duration > limits.max) {
    return `La durée maximale est de ${Math.round(limits.max / 86_400_000)} jours pour cette action.`
  }
  return null
}

export interface ApplyPunishmentResult {
  caseDoc: ModCaseDoc
  dm: DmResult
}

export async function applyPunishment(
  client: Client,
  guild: Guild,
  target: CaseTarget,
  moderator: CaseActor,
  action: CardAction,
  reason: string,
  duration: number | null
): Promise<{ ok: true; result: ApplyPunishmentResult } | { ok: false; error: string }> {
  const moderatorMember = await guild.members.fetch(moderator.id).catch(() => null)
  if (!moderatorMember) {
    return { ok: false, error: "Impossible de vérifier vos permissions (membre introuvable)." }
  }
  if (!moderatorMember.permissions.has(ACTION_PERMISSIONS[action])) {
    return {
      ok: false,
      error: `Vous n'avez pas la permission nécessaire pour **${CARD_ACTION_LABELS[action]}** (${permissionLabel(action)}).`,
    }
  }

  const targetMember = await guild.members.fetch(target.id).catch(() => null)
  if (targetMember) {
    const me = await guild.members.fetchMe()
    const hierarchyError = checkModerationTarget(moderatorMember, targetMember, me)
    if (hierarchyError) {
      return { ok: false, error: hierarchyError }
    }
  }

  const finish = async (c: ModCaseDoc): Promise<{ ok: true; result: ApplyPunishmentResult }> => {
    let dm: DmResult = { status: "sent" }
    try {
      const user = await client.users.fetch(target.id)
      dm = await notifyUser(user, guild.name, ACTION_LABELS[action], reason, duration, c.caseIdFormatted)
    } catch {
      dm = { status: "failed" as const, error: "Utilisateur introuvable." }
    }
    await updateCaseDm(c, dm)
    await logModCase(client, c)
    return { ok: true, result: { caseDoc: c, dm } }
  }

  try {
    switch (action) {
      case "WARN": {
        const warningId = await nextWarningId(guild.id)
        const c = await createCase({
          guild,
          target,
          moderator,
          action,
          reason,
          metadata: { warningId },
        })
        await Warning.create({
          warningId,
          warningIdFormatted: formatWarningId(warningId),
          guildId: guild.id,
          userId: target.id,
          username: target.username,
          globalName: target.globalName,
          moderatorId: moderator.id,
          moderatorUsername: moderator.username,
          reason,
          timestamp: c.startedAt,
          caseId: c.caseId,
          caseIdFormatted: c.caseIdFormatted,
          revoked: false,
        })
        return finish(c)
      }

      case "KICK": {
        if (!targetMember) return { ok: false, error: "Cet utilisateur n'est plus dans le serveur." }
        if (!targetMember.kickable) {
          return { ok: false, error: "Le bot ne peut pas expulser ce membre (permissions ou hiérarchie insuffisantes)." }
        }
        await targetMember.kick(reason)
        const c = await createCase({ guild, target, moderator, action, reason })
        return finish(c)
      }

      case "BAN": {
        if (targetMember && !targetMember.bannable) {
          return { ok: false, error: "Le bot ne peut pas bannir ce membre (permissions ou hiérarchie insuffisantes)." }
        }
        await guild.members.ban(target.id, { reason })
        const c = await createCase({ guild, target, moderator, action, reason })
        return finish(c)
      }

      case "TIMEOUT": {
        if (!targetMember) return { ok: false, error: "Cet utilisateur n'est plus dans le serveur." }
        if (!targetMember.moderatable) {
          return { ok: false, error: "Le bot ne peut pas exclure ce membre (permissions ou hiérarchie insuffisantes)." }
        }
        const ms = duration ?? 0
        await targetMember.timeout(ms, reason)
        const c = await createCase({
          guild,
          target,
          moderator,
          action,
          reason,
          duration: ms,
          endAt: Date.now() + ms,
        })
        return finish(c)
      }

      case "MUTE": {
        if (!targetMember) return { ok: false, error: "Cet utilisateur n'est plus dans le serveur." }
        const active = await findActiveCase(guild.id, "mute", target.id)
        if (active) return { ok: false, error: `Cet utilisateur est déjà muté (${active.caseIdFormatted}).` }
        await addMuteRole(guild, targetMember, reason)
        const c = await createCase({ guild, target, moderator, action, reason })
        return finish(c)
      }

      case "TEMPBAN": {
        if (targetMember && !targetMember.bannable) {
          return { ok: false, error: "Le bot ne peut pas bannir ce membre (permissions ou hiérarchie insuffisantes)." }
        }
        const ms = duration ?? 0
        await guild.members.ban(target.id, { reason })
        const endAt = Date.now() + ms
        const c = await createCase({
          guild,
          target,
          moderator,
          action,
          reason,
          duration: ms,
          endAt,
          metadata: { temporary: true },
        })
        registerTempSanction(client, {
          guildId: guild.id,
          userId: target.id,
          type: "TEMPBAN",
          caseId: c.caseId,
          expiresAt: endAt,
        })
        return finish(c)
      }

      case "TEMPMUTE": {
        if (!targetMember) return { ok: false, error: "Cet utilisateur n'est plus dans le serveur." }
        const active = await findActiveCase(guild.id, "mute", target.id)
        if (active) return { ok: false, error: `Cet utilisateur est déjà muté (${active.caseIdFormatted}).` }
        const ms = duration ?? 0
        await addMuteRole(guild, targetMember, reason)
        const endAt = Date.now() + ms
        const c = await createCase({
          guild,
          target,
          moderator,
          action,
          reason,
          duration: ms,
          endAt,
          metadata: { temporary: true },
        })
        registerTempSanction(client, {
          guildId: guild.id,
          userId: target.id,
          type: "TEMPMUTE",
          caseId: c.caseId,
          expiresAt: endAt,
        })
        return finish(c)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await createCase({
        guild,
        target,
        moderator,
        action: action as ModAction,
        reason,
        status: "FAILED",
        error: message,
      }).then((c) => logModCase(client, c))
    } catch {
      /* best-effort */
    }
    return { ok: false, error: `Une erreur est survenue : \`${message}\`` }
  }
}

function permissionLabel(action: CardAction): string {
  switch (action) {
    case "WARN":
      return "Gérer les messages"
    case "KICK":
      return "Expulser des membres"
    case "BAN":
    case "TEMPBAN":
      return "Bannir des membres"
    case "TIMEOUT":
    case "MUTE":
    case "TEMPMUTE":
      return "Modérer les membres"
  }
}
