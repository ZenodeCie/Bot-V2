/**
 * Planning des rappels : récurrences simples et calcul de la prochaine échéance.
 * Aucune dépendance externe, aucun exec.
 */

import { nextCronOccurrence } from "./cron.js"
import { MAX_LEAD_MS, type ReminderRecurrence } from "./limits.js"

const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR
const MS_PER_MONTH = 30 * MS_PER_DAY

/** Garde-fou : un cron pathologique ne doit pas boucler à l'infini. */
const MAX_SKIP_ITERATIONS = 500

/** Ajoute n mois en clampant le jour sur la longueur du mois cible. */
export function addMonths(ts: number, months: number): number {
  const date = new Date(ts)
  const day = date.getDate()
  const target = new Date(date.getTime())
  target.setMonth(date.getMonth() + months)
  // setMonth déborde sur le mois suivant (31 janvier + 1 mois = 3 mars) :
  // on ramène le jour au dernier jour du mois visé.
  if (target.getMonth() !== (date.getMonth() + months) % 12) {
    target.setDate(0)
  }
  if (target.getDate() < day) {
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
    target.setDate(lastDay)
  }
  return target.getTime()
}

function nextDaily(ts: number): number {
  return ts + MS_PER_DAY
}

function nextWeekly(ts: number): number {
  return ts + 7 * MS_PER_DAY
}

function nextMonthly(ts: number): number {
  return addMonths(ts, 1)
}

/**
 * Prochaine occurrence à partir de l'échéance qui vient de se déclencher.
 * Retourne `null` si la récurrence ne produit plus rien (cron impossible).
 */
export function nextOccurrence(record: { recurrence: ReminderRecurrence; cronExpr: string | null }, from: number): number | null {
  switch (record.recurrence) {
    case "daily":
      return nextDaily(from)
    case "weekly":
      return nextWeekly(from)
    case "monthly":
      return nextMonthly(from)
    case "custom":
      return record.cronExpr ? nextCronOccurrence(record.cronExpr, from) : null
    default:
      return null
  }
}

/**
 * Échéance suivante strictement postérieure à `after`.
 *
 * Le rattrapage est volontairement borné : après un redémarrage ou une panne,
 * on tire une seule fois puis on saute les occurrences déjà dépassées. Un
 * quotidien manqué trois jours ne se déclenche donc pas trois fois d'affilée.
 */
export function computeNextAt(record: { recurrence: ReminderRecurrence; cronExpr: string | null }, after: number): number | null {
  if (record.recurrence === "none") return null

  let next = nextOccurrence(record, after)
  let guard = 0
  while (next !== null && next <= after && guard < MAX_SKIP_ITERATIONS) {
    next = nextOccurrence(record, next)
    guard++
  }
  if (next === null) return null
  // Un cron très espacé (annuel) ne doit pas non plus partir dans 300 ans.
  return next > after + MAX_LEAD_MS ? null : next
}
