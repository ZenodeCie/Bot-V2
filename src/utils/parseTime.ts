const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60000,
  h: 3600000,
  d: 86400000,
}

export default function parseTime(str: string): number | null {
  const match = /^(\d+)\s*([a-z]+)?$/i.exec(str.trim())
  if (!match) return null
  const value = Number(match[1])
  const unit = (match[2] ?? "s").toLowerCase()
  const multiplier = UNITS[unit]
  if (!multiplier) return null
  return value * multiplier
}
