import { AttachmentBuilder, type Client, type Guild } from "discord.js"
import { newEntryId, newPanelId, normalizePanelInput } from "./schema.js"

/**
 * Export / import JSON des panels rôles-réactions.
 * Format : `{ version: 1, exportGuildId, exportedAt, panels: RolePanel[] }`.
 */

const FORMAT_VERSION = 1

export async function buildExportAttachment(client: Client, guild: Guild): Promise<AttachmentBuilder | null> {
  const engine = client.reactionroles
  const panels = await engine.getPanels(guild.id)
  const payload = {
    version: FORMAT_VERSION,
    exportGuildId: guild.id,
    exportedAt: new Date().toISOString(),
    panels,
  }
  const json = JSON.stringify(payload, null, 2)
  return new AttachmentBuilder(Buffer.from(json, "utf-8"), { name: `rr-panels-${guild.id}.json` })
}

export interface ImportResult {
  ok: boolean
  imported: number
  error?: string
}

/** Importe des panels depuis le JSON. Réutilise les ids si même serveur, sinon re-cible. */
export async function importPanelsFromText(client: Client, guild: Guild, text: string): Promise<ImportResult> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, imported: 0, error: "> *JSON invalide.*" }
  }

  const record = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  if (!record) return { ok: false, imported: 0, error: "> *Fichier JSON invalide.*" }

  const rawPanels: unknown[] = Array.isArray(record.panels)
    ? (record.panels as unknown[])
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : [record]
  if (rawPanels.length === 0) return { ok: false, imported: 0, error: "> *Aucun panel dans le fichier.*" }

  const sourceGuildId = typeof record.exportGuildId === "string" && record.exportGuildId ? record.exportGuildId : guild.id
  const sameGuild = sourceGuildId === guild.id
  const engine = client.reactionroles

  let imported = 0
  for (const raw of rawPanels) {
    const panel = normalizePanelInput(raw)
    if (!panel) continue
    if (!sameGuild) {
      panel.guildId = guild.id
      panel.id = newPanelId()
      panel.channelId = null
      panel.messageId = null
      panel.logChannelId = null
      for (const entry of panel.entries) entry.id = newEntryId()
    }
    await engine.savePanel(panel)
    imported += 1
  }

  if (imported === 0) return { ok: false, imported: 0, error: "> *Aucun panel valide trouvé dans le fichier.*" }
  return { ok: true, imported }
}