import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { asBotConfig, mergeApplicationEmojis, type BotConfig } from "../shared/botConfig.js"
import { assertValidBotId } from "../shared/botId.js"
import type { HostEnv } from "./env.js"

export class ConfigStore {
  constructor(private readonly env: HostEnv) {}

  async ensureDir(): Promise<void> {
    await mkdir(this.env.configsDir, { recursive: true, mode: 0o700 })
    await chmod(this.env.configsDir, 0o700).catch(() => undefined)
  }

  pathFor(botId: string): string {
    const id = assertValidBotId(botId)
    return join(this.env.configsDir, `${id}.json`)
  }

  async write(botId: string, config: BotConfig): Promise<string> {
    await this.ensureDir()
    const id = assertValidBotId(botId)
    const path = this.pathFor(id)
    const existing = await this.read(id)
    const application_emojis = mergeApplicationEmojis(existing?.application_emojis, config.application_emojis)
    const payload: BotConfig = { ...config, bot_id: id }
    if (application_emojis) payload.application_emojis = application_emojis
    else delete payload.application_emojis
    const temp = `${path}.tmp`
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(temp, path)
    await chmod(path, 0o600)
    return path
  }

  async read(botId: string): Promise<BotConfig | null> {
    const path = this.pathFor(botId)
    if (!existsSync(path)) return null
    try {
      const raw: unknown = JSON.parse(await readFile(path, "utf8"))
      return asBotConfig(raw)
    } catch {
      return null
    }
  }

  async remove(botId: string): Promise<void> {
    const path = this.pathFor(botId)
    try {
      await unlink(path)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code !== "ENOENT") throw error
    }
  }

  exists(botId: string): boolean {
    return existsSync(this.pathFor(botId))
  }
}
