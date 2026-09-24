import type { PanelResponses, RolePanel } from "./schema.js"

/**
 * Textes du module réaction-rôles : interpolation de variables et réponses par langue.
 * Le schéma porte les valeurs par défaut (FR/EN) ; les panels restent 100 % personnalisables.
 */

export interface InterpolationVars {
  user?: string
  userMention?: string
  role?: string
  roleMention?: string
  server?: string
  panel?: string
  emoji?: string
  duration?: string
  reason?: string
}

const TOKEN_RE = /\{([a-zA-Z]+)\}/g

export function interpolateText(template: string, vars: InterpolationVars): string {
  return template.replace(TOKEN_RE, (match: string, key: string) => {
    const value = (vars as Record<string, string | undefined>)[key]
    return value !== undefined && value !== null ? value : match
  })
}

export function responseText(panel: RolePanel, key: keyof PanelResponses, vars: InterpolationVars = {}): string {
  return interpolateText(panel.responses[key] ?? "", vars)
}

export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}j`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (parts.length === 0) parts.push(`${Math.max(1, Math.floor(ms / 1000))}s`)
  return parts.join(" ")
}

export function joinRoleNames(names: string[], language: "fr" | "en"): string {
  const list = [...new Set(names)].filter(Boolean)
  if (list.length === 0) return language === "en" ? "*none*" : "*aucun*"
  if (list.length === 1) return `**${list[0]}**`
  return list.map((name) => `**${name}**`).join(", ")
}