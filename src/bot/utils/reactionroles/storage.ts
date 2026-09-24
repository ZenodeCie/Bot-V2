import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import config from "../../config.js"
import mongoClient from "../mongoClient.js"
import {
  ReactionRolePanels,
  ReactionRoleTempGrants,
  mapGrantDoc,
  mapPanelDoc,
  normalizeGrant,
  normalizePanel,
  type RolePanel,
  type TempRoleGrant,
} from "./schema.js"

/**
 * Couche de stockage du module réaction-rôles.
 * Mongo (base partagée, scopée botId) si la connexion est établie,
 * sinon fichiers JSON dans `data/{bot_id}/reactionroles/` (mode alone sans Mongo).
 */

export interface ReactionRoleStore {
  kind: "mongo" | "file"
  listPanels(guildId: string): Promise<RolePanel[]>
  listAllPanels(): Promise<RolePanel[]>
  getPanel(guildId: string, panelId: string): Promise<RolePanel | null>
  savePanel(panel: RolePanel): Promise<void>
  deletePanel(guildId: string, panelId: string): Promise<void>
  listAllGrants(): Promise<TempRoleGrant[]>
  listGrantsForUser(guildId: string, userId: string): Promise<TempRoleGrant[]>
  saveGrant(grant: TempRoleGrant): Promise<void>
  claimGrant(
    guildId: string,
    userId: string,
    roleId: string,
    panelId: string,
    entryId: string
  ): Promise<TempRoleGrant | null>
  deleteGrantsForEntry(guildId: string, panelId: string, entryId: string): Promise<void>
  deleteGrantsForUserEntry(guildId: string, userId: string, panelId: string, entryId: string): Promise<void>
  deleteGrantsForPanel(guildId: string, panelId: string): Promise<void>
  deleteGrantsForRole(guildId: string, roleId: string): Promise<void>
  deleteGrantsForGuild(guildId: string): Promise<void>
}

let store: ReactionRoleStore | undefined

export function reactionRoleStore(): ReactionRoleStore {
  if (!store) {
    store = mongoClient.readyState === 1 ? new MongoPanelStore() : new FilePanelStore()
    console.log(`[ReactionRoles] Stockage ${store.kind} actif (botId=${config.botId}).`)
  }
  return store
}

export function resetReactionRoleStore(): void {
  store = undefined
}

// ---------------------------------------------------------------------------
// Backend Mongo
// ---------------------------------------------------------------------------

class MongoPanelStore implements ReactionRoleStore {
  readonly kind = "mongo" as const

  async listPanels(guildId: string): Promise<RolePanel[]> {
    const raw = await ReactionRolePanels.find({ guildId }).select("-_id -__v -botId").lean()
    return raw.map((doc) => mapPanelDoc(doc as unknown as Record<string, unknown>))
  }

  async listAllPanels(): Promise<RolePanel[]> {
    const raw = await ReactionRolePanels.find({}).select("-_id -__v -botId").lean()
    return raw.map((doc) => mapPanelDoc(doc as unknown as Record<string, unknown>))
  }

  async getPanel(guildId: string, panelId: string): Promise<RolePanel | null> {
    const doc = await ReactionRolePanels.findOne({ guildId, panelId }).select("-_id -__v -botId").lean()
    return doc ? mapPanelDoc(doc as unknown as Record<string, unknown>) : null
  }

  async savePanel(panel: RolePanel): Promise<void> {
    const { id: panelId, ...rest } = panel
    await ReactionRolePanels.updateOne({ guildId: panel.guildId, panelId }, { $set: { ...rest, panelId } }, { upsert: true })
  }

  async deletePanel(guildId: string, panelId: string): Promise<void> {
    await ReactionRolePanels.deleteOne({ guildId, panelId })
  }

  async listAllGrants(): Promise<TempRoleGrant[]> {
    const raw = await ReactionRoleTempGrants.find({}).select("-_id -__v -botId").lean()
    return raw.map((doc) => mapGrantDoc(doc as unknown as Record<string, unknown>))
  }

  async listGrantsForUser(guildId: string, userId: string): Promise<TempRoleGrant[]> {
    const raw = await ReactionRoleTempGrants.find({ guildId, userId }).select("-_id -__v -botId").lean()
    return raw.map((doc) => mapGrantDoc(doc as unknown as Record<string, unknown>))
  }

  async saveGrant(grant: TempRoleGrant): Promise<void> {
    const { id: grantId, ...rest } = grant
    await ReactionRoleTempGrants.updateOne(
      { guildId: grant.guildId, userId: grant.userId, roleId: grant.roleId, panelId: grant.panelId, entryId: grant.entryId },
      { $set: { ...rest, grantId } },
      { upsert: true }
    )
  }

  async claimGrant(
    guildId: string,
    userId: string,
    roleId: string,
    panelId: string,
    entryId: string
  ): Promise<TempRoleGrant | null> {
    const doc = await ReactionRoleTempGrants.findOneAndDelete({ guildId, userId, roleId, panelId, entryId })
    return doc ? mapGrantDoc(doc as unknown as Record<string, unknown>) : null
  }

  async deleteGrantsForEntry(guildId: string, panelId: string, entryId: string): Promise<void> {
    await ReactionRoleTempGrants.deleteMany({ guildId, panelId, entryId })
  }

  async deleteGrantsForUserEntry(guildId: string, userId: string, panelId: string, entryId: string): Promise<void> {
    await ReactionRoleTempGrants.deleteMany({ guildId, userId, panelId, entryId })
  }

  async deleteGrantsForPanel(guildId: string, panelId: string): Promise<void> {
    await ReactionRoleTempGrants.deleteMany({ guildId, panelId })
  }

  async deleteGrantsForRole(guildId: string, roleId: string): Promise<void> {
    await ReactionRoleTempGrants.deleteMany({ guildId, roleId })
  }

  async deleteGrantsForGuild(guildId: string): Promise<void> {
    await ReactionRoleTempGrants.deleteMany({ guildId })
  }
}

// ---------------------------------------------------------------------------
// Backend fichiers (fallback sans Mongo)
// ---------------------------------------------------------------------------

const ROOT_DIR = join(config.dataDir, "reactionroles")
const PANELS_DIR = join(ROOT_DIR, "panels")
const TEMP_FILE = join(ROOT_DIR, "temp.json")

interface FileLockEntry {
  previous: Promise<unknown>
}

const locks = new Map<string, FileLockEntry>()

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const entry = locks.get(key) ?? { previous: Promise.resolve() }
  const run = entry.previous.then(() => fn(), () => fn())
  const slot = run.catch(() => undefined)
  locks.set(key, { previous: slot })
  void slot.finally(() => {
    if (locks.get(key)?.previous === slot) locks.delete(key)
  })
  return run
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown
  } catch {
    return null
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 })
  await rename(tmp, path).catch(async (error: unknown) => {
    await writeFile(path, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 })
    throw error
  })
}

function panelsPath(guildId: string): string {
  return join(PANELS_DIR, `${guildId}.json`)
}

function asPanelsArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
}

async function readPanels(guildId: string): Promise<RolePanel[]> {
  const arr = asPanelsArray(await readJson(panelsPath(guildId)))
  return arr.map((raw) => normalizePanel(raw)).filter((panel) => panel.guildId === guildId || !panel.guildId)
}

async function readAllPanels(): Promise<RolePanel[]> {
  let files: string[] = []
  try {
    files = await readdir(PANELS_DIR)
  } catch {
    return []
  }
  const out: RolePanel[] = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    const arr = asPanelsArray(await readJson(join(PANELS_DIR, file)))
    for (const raw of arr) {
      const panel = normalizePanel(raw)
      if (panel.guildId) out.push(panel)
    }
  }
  return out
}

async function readGrants(): Promise<TempRoleGrant[]> {
  const arr = asPanelsArray(await readJson(TEMP_FILE))
  return arr.map((raw) => normalizeGrant(raw))
}

async function writeGrants(grants: TempRoleGrant[]): Promise<void> {
  await writeJsonAtomic(TEMP_FILE, grants)
}

class FilePanelStore implements ReactionRoleStore {
  readonly kind = "file" as const

  async listPanels(guildId: string): Promise<RolePanel[]> {
    return withLock("panels", async () => (await readPanels(guildId)).filter((panel) => panel.guildId === guildId))
  }

  async listAllPanels(): Promise<RolePanel[]> {
    return withLock("panels_all", () => readAllPanels())
  }

  async getPanel(guildId: string, panelId: string): Promise<RolePanel | null> {
    const panels = await this.listPanels(guildId)
    return panels.find((panel) => panel.id === panelId) ?? null
  }

  async savePanel(panel: RolePanel): Promise<void> {
    await withLock(`panels:${panel.guildId}`, async () => {
      const panels = await readPanels(panel.guildId)
      const existing = panels.findIndex((item) => item.id === panel.id)
      if (existing === -1) panels.push(panel)
      else panels[existing] = panel
      await writeJsonAtomic(panelsPath(panel.guildId), panels)
    })
  }

  async deletePanel(guildId: string, panelId: string): Promise<void> {
    await withLock(`panels:${guildId}`, async () => {
      const panels = (await readPanels(guildId)).filter((panel) => panel.id !== panelId)
      await writeJsonAtomic(panelsPath(guildId), panels)
    })
  }

  async listAllGrants(): Promise<TempRoleGrant[]> {
    return withLock("temp", () => readGrants())
  }

  async listGrantsForUser(guildId: string, userId: string): Promise<TempRoleGrant[]> {
    const grants = await this.listAllGrants()
    return grants.filter((grant) => grant.guildId === guildId && grant.userId === userId)
  }

  async saveGrant(grant: TempRoleGrant): Promise<void> {
    await withLock("temp", async () => {
      const grants = await readGrants()
      const idx = grants.findIndex(
        (item) =>
          item.guildId === grant.guildId &&
          item.userId === grant.userId &&
          item.roleId === grant.roleId &&
          item.panelId === grant.panelId &&
          item.entryId === grant.entryId
      )
      if (idx === -1) grants.push(grant)
      else grants[idx] = grant
      await writeGrants(grants)
    })
  }

  async claimGrant(
    guildId: string,
    userId: string,
    roleId: string,
    panelId: string,
    entryId: string
  ): Promise<TempRoleGrant | null> {
    return withLock("temp", async () => {
      const grants = await readGrants()
      const idx = grants.findIndex(
        (item) =>
          item.guildId === guildId && item.userId === userId && item.roleId === roleId && item.panelId === panelId && item.entryId === entryId
      )
      if (idx === -1) return null
      const [grant] = grants.splice(idx, 1)
      await writeGrants(grants)
      return grant
    })
  }

  async deleteGrantsForEntry(guildId: string, panelId: string, entryId: string): Promise<void> {
    await withLock("temp", async () => {
      const grants = (await readGrants()).filter(
        (grant) => !(grant.guildId === guildId && grant.panelId === panelId && grant.entryId === entryId)
      )
      await writeGrants(grants)
    })
  }

  async deleteGrantsForUserEntry(guildId: string, userId: string, panelId: string, entryId: string): Promise<void> {
    await withLock("temp", async () => {
      const grants = (await readGrants()).filter(
        (grant) => !(grant.guildId === guildId && grant.userId === userId && grant.panelId === panelId && grant.entryId === entryId)
      )
      await writeGrants(grants)
    })
  }

  async deleteGrantsForPanel(guildId: string, panelId: string): Promise<void> {
    await withLock("temp", async () => {
      const grants = (await readGrants()).filter((grant) => !(grant.guildId === guildId && grant.panelId === panelId))
      await writeGrants(grants)
    })
  }

  async deleteGrantsForRole(guildId: string, roleId: string): Promise<void> {
    await withLock("temp", async () => {
      const grants = (await readGrants()).filter((grant) => !(grant.guildId === guildId && grant.roleId === roleId))
      await writeGrants(grants)
    })
  }

  async deleteGrantsForGuild(guildId: string): Promise<void> {
    await withLock("temp", async () => {
      const grants = (await readGrants()).filter((grant) => grant.guildId !== guildId)
      await writeGrants(grants)
    })
  }
}