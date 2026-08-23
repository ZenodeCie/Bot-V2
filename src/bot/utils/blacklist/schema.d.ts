import type { Punishment } from "../antiraid/schema.js"
import type { Model } from "mongoose"

export declare const BLACKLIST_PUNISHMENTS: readonly ["kick", "ban", "timeout", "none"]
export type BlacklistPunishment = (typeof BLACKLIST_PUNISHMENTS)[number]

export interface BlacklistConfigDoc {
  guildId: string
  enabled: boolean
  punishment: BlacklistPunishment
  duration: number
  logChannel: string | null
}

export interface BlacklistEntryDoc {
  guildId: string
  userId: string
  username: string
  globalName: string | null
  reason: string
  moderatorId: string
  moderatorUsername: string
  addedAt: number
}

export interface AddEntryInput {
  guildId: string
  userId: string
  username: string
  globalName: string | null
  reason: string
  moderatorId: string
  moderatorUsername: string
}

export declare const BlacklistConfig: Model<BlacklistConfigDoc>
export declare const BlacklistEntry: Model<BlacklistEntryDoc>

export declare function getConfig(guildId: string): Promise<BlacklistConfigDoc>
export declare function addEntry(input: AddEntryInput): Promise<BlacklistEntryDoc>
export declare function removeEntry(guildId: string, userId: string): Promise<boolean>
export declare function getEntry(guildId: string, userId: string): Promise<BlacklistEntryDoc | null>
export declare function listEntries(guildId: string, skip: number, limit: number): Promise<BlacklistEntryDoc[]>
export declare function countEntries(guildId: string): Promise<number>
