/**
 * Parseur cron 5 champs — `minute heure jour-du-mois mois jour-de-semaine`.
 *
 * Volontairement minimal et sans dépendance : ni exec, ni macro (`@daily`),
 * ni seconde. Le parcours se fait par jour puis heure puis minute, ce qui évite
 * le scan de millions de minutes qu'imposerait une boucle naïve.
 */

const FIELD_MINUTE = 0
const FIELD_HOUR = 1
const FIELD_DAY_OF_MONTH = 2
const FIELD_MONTH = 3
const FIELD_DAY_OF_WEEK = 4
const FIELDS = 5

const MAX_MONTH = 12
const MAX_MONTH_DAY = new Date(2000, MAX_MONTH, 0).getDate()
const MAX_DAY_OF_WEEK = 6

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

const MAX_SCAN_DAYS = 366 * 4

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const DAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

export interface CronFields {
  minutes: Set<number>
  hours: Set<number>
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
  domRestricted: boolean
  dowRestricted: boolean
}

function maxForField(field: number): number {
  switch (field) {
    case FIELD_MINUTE:
      return 59
    case FIELD_HOUR:
      return 23
    case FIELD_DAY_OF_MONTH:
      return MAX_MONTH_DAY
    case FIELD_MONTH:
      return MAX_MONTH
    default:
      return MAX_DAY_OF_WEEK
  }
}

function minForField(field: number): number {
  return field === FIELD_DAY_OF_MONTH || field === FIELD_MONTH ? 1 : 0
}

function parseFieldValue(raw: string, field: number): number {
  const lower = raw.toLowerCase()
  const named = field === FIELD_MONTH ? MONTH_NAMES[lower] : field === FIELD_DAY_OF_WEEK ? DAY_NAMES[lower] : undefined
  if (named !== undefined) return named
  // Sunday peut s'écrire 7 comme 0.
  if (field === FIELD_DAY_OF_WEEK && lower === "7") return 0
  return Number(lower)
}

function parseField(raw: string, field: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of raw.split(",")) {
    const item = part.trim()
    if (!item) return null

    const segments = item.split("/")
    if (segments.length > 2) return null
    const rangePart = segments[0] ?? ""
    const stepPart = segments[1]
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1) return null

    const isWildcard = rangePart === "*" || rangePart === ""
    const bounds = isWildcard ? [] : rangePart.split("-")
    if (bounds.length > 2) return null

    let from: number
    let to: number
    if (isWildcard) {
      from = minForField(field)
      to = maxForField(field)
    } else if (bounds.length === 1) {
      from = parseFieldValue(bounds[0], field)
      to = from
      if (!Number.isInteger(from)) return null
      // `a/n` : à partir de a, par pas de n.
      if (stepPart !== undefined) to = maxForField(field)
    } else {
      from = parseFieldValue(bounds[0], field)
      to = parseFieldValue(bounds[1], field)
      if (!Number.isInteger(from) || !Number.isInteger(to)) return null
    }

    if (to < from) return null
    // Chaque valeur générée doit rester dans les bornes de son champ :
    // `60 * * * *` ou `* * 32 * *` sont rejetés ici.
    const min = minForField(field)
    const max = maxForField(field)
    for (let value = from; value <= to; value += step) {
      if (value < min || value > max) return null
      out.add(value)
    }
  }
  return out.size > 0 ? out : null
}

function isRestricted(token: string): boolean {
  return token.trim() !== "*"
}

export function parseCron(expr: string): CronFields | null {
  const tokens = expr.trim().split(/\s+/)
  if (tokens.length !== FIELDS) return null

  const minutes = parseField(tokens[FIELD_MINUTE], FIELD_MINUTE)
  const hours = parseField(tokens[FIELD_HOUR], FIELD_HOUR)
  const daysOfMonth = parseField(tokens[FIELD_DAY_OF_MONTH], FIELD_DAY_OF_MONTH)
  const months = parseField(tokens[FIELD_MONTH], FIELD_MONTH)
  const daysOfWeek = parseField(tokens[FIELD_DAY_OF_WEEK], FIELD_DAY_OF_WEEK)
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domRestricted: isRestricted(tokens[FIELD_DAY_OF_MONTH]),
    dowRestricted: isRestricted(tokens[FIELD_DAY_OF_WEEK]),
  }
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null
}

/** Règle Vixie : jour-du-mois ET jour-de-semaine quand les deux sont restreints. */
function dayMatches(fields: CronFields, date: Date): boolean {
  const domMatch = fields.daysOfMonth.has(date.getDate())
  const dowMatch = fields.daysOfWeek.has(date.getDay())
  if (fields.domRestricted && fields.dowRestricted) return domMatch || dowMatch
  if (fields.domRestricted) return domMatch
  if (fields.dowRestricted) return dowMatch
  return true
}

function startOfLocalDay(base: number): number {
  const date = new Date(base)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Timestamp de la prochaine occurrence strictement postérieure à `from`. */
export function nextCronOccurrence(expr: string, from: number): number | null {
  const fields = parseCron(expr)
  if (!fields) return null

  const minutes = [...fields.minutes].sort((a, b) => a - b)
  const hours = [...fields.hours].sort((a, b) => a - b)
  let cursor = Math.floor(from / MINUTE_MS) * MINUTE_MS + MINUTE_MS

  for (let day = 0; day < MAX_SCAN_DAYS; day++) {
    // Recalculé à chaque tour : un avancement de 24 h peut tomber à 23 h ou 1 h
    // les jours de changement d'heure, le recalendrage du jour corrige tout seul.
    const dayStart = startOfLocalDay(cursor)
    const date = new Date(dayStart)
    if (fields.months.has(date.getMonth() + 1) && dayMatches(fields, date)) {
      for (const hour of hours) {
        const hourStart = dayStart + hour * HOUR_MS
        // Pas de garde sur `hourStart` : une heure déjà entamée contient encore
        // des minutes à venir (`*/15` lancé à 12:30 doit donner 12:45).
        for (const minute of minutes) {
          const candidate = hourStart + minute * MINUTE_MS
          if (candidate > from) return candidate
        }
      }
    }
    // Avance d'un jour calendaire, pas de 24 h, pour rester juste à l'heure
    // d'été. `cursor` garde l'heure locale, `startOfLocalDay` la renormalise.
    const nextDay = new Date(dayStart)
    nextDay.setDate(nextDay.getDate() + 1)
    cursor = nextDay.getTime()
  }
  return null
}
