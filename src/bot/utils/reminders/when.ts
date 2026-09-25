/**
 * Parsing de l'échéance d'un rappel.
 *
 * Deux écritures sont acceptées, testées dans cet ordre :
 *   - absolu  : `2026-10-05 14:00`, `05/10/2026 14h00`, `2026-10-05T14:00`
 *   - relatif : `45min`, `2h30`, `1j`, `1h30m10s`, `3 semaines`
 *
 * Une date absolue dans le passé est refusée : le rappel ne pourrait jamais se
 * déclencher. Les durées relatives se mesurent à partir de l'instant de la
 * commande, d'où le garde-fou `MIN_LEAD_MS` côté appelant.
 */

import { MAX_LEAD_MS, MIN_LEAD_MS } from "./limits.js"

const RELATIVE_UNITS: Record<string, number> = {
  millisecondes: 1,
  milliseconde: 1,
  milliseconds: 1,
  millisecond: 1,
  ms: 1,
  msec: 1,
  secondes: 1000,
  seconde: 1000,
  seconds: 1000,
  sec: 1000,
  s: 1000,
  minutes: 60_000,
  minute: 60_000,
  min: 60_000,
  m: 60_000,
  heures: 3_600_000,
  heure: 3_600_000,
  hours: 3_600_000,
  hour: 3_600_000,
  hrs: 3_600_000,
  hr: 3_600_000,
  h: 3_600_000,
  jours: 86_400_000,
  jour: 86_400_000,
  days: 86_400_000,
  day: 86_400_000,
  j: 86_400_000,
  d: 86_400_000,
  semaines: 604_800_000,
  semaine: 604_800_000,
  weeks: 604_800_000,
  week: 604_800_000,
  sem: 604_800_000,
  w: 604_800_000,
  mois: 2_592_000_000,
  month: 2_592_000_000,
}

// Les alternatives les plus longues d'abord, sinon `3 mois` serait lu `3 m` + `ois`.
// L'unité est facultative : `2h30` se lit « 2 heures 30 minutes », le nombre nu
// valant des minutes.
const UNIT_ALTERNATION = Object.keys(RELATIVE_UNITS)
  .sort((a, b) => b.length - a.length)
  .join("|")
const BARE_NUMBER_UNIT = "m"

const ABSOLUTE_PATTERNS: RegExp[] = [
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ t]+(\d{1,2})[:h](\d{2})(?::(\d{2}))?$/i,
  /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[ t]+(\d{1,2})[:h](\d{2})(?::(\d{2}))?$/i,
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/,
  /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/,
]

/** Year-first forms put the year in capture 1, day-first forms do not. */
const YEAR_FIRST = [true, false, true, false]

/** Ce qui reste entre deux segments : séparateurs et « et ». */
function isConnectorNoise(text: string): boolean {
  return text.replace(/[\s,]|et/gi, "").length === 0
}

function buildLocalDate(parts: number[], yearFirst: boolean): number | null {
  const [a, b, c, d = 0, e = 0, f = 0] = parts
  const year = yearFirst ? a : c
  const month = b
  const day = yearFirst ? c : a

  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (d > 23 || e > 59 || f > 59) return null

  const date = new Date(year, month - 1, day, d, e, f, 0)
  // Rejet des dates qui débordent (31 février, 32 janvier…).
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date.getTime()
}

function parseAbsolute(raw: string): number | null {
  const input = raw.trim()
  for (let index = 0; index < ABSOLUTE_PATTERNS.length; index++) {
    const match = ABSOLUTE_PATTERNS[index].exec(input)
    if (!match) continue
    // Les groupes optionnels (secondes) arrivent à undefined : zéro par défaut,
    // sinon `new Date(…, NaN)` rend une date invalide.
    const parts = match.slice(1).map((part) => (part === undefined ? 0 : Number(part)))
    return buildLocalDate(parts, YEAR_FIRST[index])
  }
  return null
}

function parseRelative(raw: string): number | null {
  const input = raw.trim()
  if (!input) return null

  const re = new RegExp(`(\\d+)(?:\\s*(${UNIT_ALTERNATION}))?`, "gi")
  let total = 0
  let matched = false
  let consumed = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(input)) !== null) {
    // Tout ce qui sépare deux segments doit être du bruit, sinon `2h xyz` passe.
    if (!isConnectorNoise(input.slice(consumed, match.index))) return null
    consumed = match.index + match[0].length
    matched = true
    const unit = match[2]?.toLowerCase() ?? BARE_NUMBER_UNIT
    const multiplier = RELATIVE_UNITS[unit]
    if (multiplier === undefined) return null
    total += Number(match[1]) * multiplier
  }

  if (!matched || !isConnectorNoise(input.slice(consumed))) return null
  return total
}

/** Timestamp demandé par l'utilisateur, ou `null` si l'écriture est invalide. */
export function parseWhen(raw: string, now = Date.now()): number | null {
  const input = raw.trim()
  if (!input) return null

  const absolute = parseAbsolute(input)
  if (absolute !== null) return absolute > now ? absolute : null

  const relative = parseRelative(input)
  if (relative === null || relative <= 0) return null

  const target = now + relative
  return target - now >= MIN_LEAD_MS ? target : null
}

export function isWhenOutOfRange(target: number, now = Date.now()): boolean {
  return target - now > MAX_LEAD_MS
}

/** Exemple d'aide affiché dans la description de l'option slash et dans `/rappel list`. */
export const WHEN_EXAMPLES = ["45min", "2h30", "1j", "3 semaines", "2026-10-05 14:00"]
