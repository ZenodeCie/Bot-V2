import type { Collection, Client, Interaction, Message, PermissionResolvable } from "discord.js"
import type { Connection } from "mongoose"

export interface Command {
  name: string
  description: string
  category: string
  aliases: string[]
  permissions: PermissionResolvable[]
  usage: string
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
  }
}
