import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { KNOWN_MODULE_KEYS } from "../shared/botConfig.js"

export interface ModuleLoadSpec {
  commandGlobs: string[]
  eventGlobs: string[]
}

/** Maps core website module keys to folders/files in this repo. */
export const MODULE_LOAD_MAP: Record<string, ModuleLoadSpec> = {
  Base: {
    commandGlobs: ["commands/utils/help.js", "commands/utils/ping.js", "commands/utils/prefix.js", "commands/utils/botinfo.js", "commands/utils/config.js", "commands/dev", "commands/fun"],
    eventGlobs: ["events/ready.js", "events/messageCreate.js", "events/interactionCreate.js", "events/guildCreate.js"],
  },
  Utilities: {
    commandGlobs: ["commands/utils/userinfo.js", "commands/utils/emoji.js"],
    eventGlobs: [],
  },
  Moderation: {
    commandGlobs: ["commands/moderation", "commands/blacklist"],
    eventGlobs: ["events/moderation", "events/blacklist"],
  },
  ModerationAvancee: {
    commandGlobs: ["commands/antiraid"],
    eventGlobs: ["events/antiraid"],
  },
  Aeroport: {
    commandGlobs: ["commands/aeroport"],
    eventGlobs: ["events/aeroport"],
  },
  Captcha: {
    commandGlobs: ["commands/captcha"],
    eventGlobs: ["events/captcha"],
  },
  Logs: {
    commandGlobs: ["commands/logs"],
    eventGlobs: ["events/logs"],
  },
  Giveaway: {
    commandGlobs: ["commands/giveaway"],
    eventGlobs: [],
  },
  Levels: {
    commandGlobs: ["commands/levels"],
    eventGlobs: ["events/levels"],
  },
  InformationPanel: {
    commandGlobs: ["commands/informationpanel"],
    eventGlobs: [],
  },
  "Message-Horaire": {
    commandGlobs: ["commands/message-horaire"],
    eventGlobs: [],
  },
  StaffList: {
    commandGlobs: ["commands/stafflist"],
    eventGlobs: ["events/stafflist"],
  },
  Rules: {
    commandGlobs: ["commands/rules"],
    eventGlobs: [],
  },
  Invitations: {
    commandGlobs: ["commands/invitations"],
    eventGlobs: ["events/invitations"],
  },
  Tickets: {
    commandGlobs: ["commands/tickets"],
    eventGlobs: [],
  },
}

export function resolveEnabledModules(requested: string[]): { enabled: Set<string>; unknown: string[] } {
  const enabled = new Set<string>(["Base"])
  const unknown: string[] = []
  for (const name of requested) {
    if (name === "Base") continue
    if (MODULE_LOAD_MAP[name]) {
      enabled.add(name)
      continue
    }
    unknown.push(name)
    if (!KNOWN_MODULE_KEYS.includes(name as (typeof KNOWN_MODULE_KEYS)[number])) {
      continue
    }
  }
  return { enabled, unknown }
}

export function collectJsFiles(root: string, relativeGlob: string): string[] {
  const full = join(root, relativeGlob)
  if (full.endsWith(".js")) {
    return existsSync(full) ? [full] : []
  }
  if (!existsSync(full) || !statSync(full).isDirectory()) return []
  return listJsRecursive(full)
}

function listJsRecursive(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) {
      out.push(...listJsRecursive(full))
      continue
    }
    if (entry.endsWith(".js")) out.push(full)
  }
  return out
}

export function filesForModules(root: string, modules: Iterable<string>): { commands: string[]; events: string[] } {
  const commands = new Set<string>()
  const events = new Set<string>()
  for (const name of modules) {
    const spec = MODULE_LOAD_MAP[name]
    if (!spec) continue
    for (const glob of spec.commandGlobs) {
      for (const file of collectJsFiles(root, glob)) commands.add(file)
    }
    for (const glob of spec.eventGlobs) {
      for (const file of collectJsFiles(root, glob)) events.add(file)
    }
  }
  return { commands: [...commands], events: [...events] }
}
