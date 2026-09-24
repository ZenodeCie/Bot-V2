import { randomBytes } from "node:crypto"
import type { Client, Message } from "discord.js"
import { replyError, requireGuild } from "../../utils/moderation/helpers.js"
import type { RolePanel } from "../../utils/reactionroles/schema.js"

/** Résout un panel par id, nom exact ou préfixe de nom (insensible à la casse). */
export async function findPanelByQuery(client: Client, guildId: string, query: string): Promise<RolePanel | null> {
  const trimmed = (query || "").trim()
  if (!trimmed) return null
  const q = trimmed.toLowerCase()
  const panels = await client.reactionroles.getPanels(guildId)
  return (
    panels.find((panel) => panel.id === trimmed || panel.name.toLowerCase() === q || panel.name.toLowerCase().startsWith(q)) ??
    null
  )
}

/** Résout le panel demandé par un utilisateur ou répond une erreur. */
export async function requirePanel(client: Client, message: Message, query: string): Promise<RolePanel | null> {
  const guild = requireGuild(message)
  if (!guild) return null
  const panel = await findPanelByQuery(client, guild.id, query)
  if (!panel) {
    await replyError(message, "404 Not Found", "> *Panel introuvable. Utilisez `/rr list` pour voir vos panels.*")
    return null
  }
  return panel
}

export function panelContext(panel: RolePanel): string {
  const modeLabels: Record<RolePanel["mode"], string> = {
    normal: "Normal",
    unique: "Unique",
    verify: "Vérification",
    drop: "Drop",
    reversed: "Inversé",
  }
  return `> **${panel.name || panel.id}** — \`${modeLabels[panel.mode]}\` — ${panel.enabled ? "activé" : "désactivé"}\n` +
    `> *${panel.entries.length} entrée${panel.entries.length > 1 ? "s" : ""} · publié : ${panel.messageId ? "<#" + panel.channelId + ">" : "non"}*`
}

/** Copie profonde d'un panel avec de nouveaux ids (pour dupliquer / réimporter). */
export function clonePanelWithFreshIds(panel: RolePanel, name?: string): RolePanel {
  const clone = JSON.parse(JSON.stringify(panel)) as RolePanel
  clone.id = randomBytes(4).toString("hex")
  clone.channelId = null
  clone.messageId = null
  clone.logChannelId = null
  clone.createdAt = Date.now()
  clone.updatedAt = Date.now()
  if (name && name.trim()) clone.name = name.trim().slice(0, 60)
  for (const entry of clone.entries) entry.id = randomBytes(3).toString("hex")
  return clone
}