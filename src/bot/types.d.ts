import type {
  ApplicationCommandOptionType,
  ChatInputCommandInteraction,
  Client,
  Collection,
  Interaction,
  Message,
  PermissionResolvable,
} from "discord.js"
import type { Connection } from "mongoose"
import type { AntiRaidEngine } from "./utils/antiraid/engine.js"

export interface SlashOption {
  name: string
  description: string
  type: ApplicationCommandOptionType
  required?: boolean
  choices?: { name: string; value: string | number }[]
  minValue?: number
  maxValue?: number
}

export interface Command {
  name: string
  description: string
  category: string
  aliases: string[]
  permissions: PermissionResolvable[]
  usage: string
  slash?: SlashOption[]
  slashName?: string
  slashRegister?: boolean
  slashArgs?: (interaction: ChatInputCommandInteraction) => string[]
  execute: (client: Client, message: Message, args: string[]) => Promise<void> | void
  handleInteraction?: (client: Client, interaction: Interaction) => Promise<boolean> | boolean
}

export type InteractionHandler = (client: Client, interaction: Interaction) => Promise<boolean> | boolean

declare module "discord.js" {
  interface Client {
    prefix: string
    commands: Collection<string, Command>
    db: Connection
    interactions: Collection<string, InteractionHandler>
    antiraid: AntiRaidEngine
    botId: string
    dataDir: string
    enabledModules: Set<string>
  }
}
