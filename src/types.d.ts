import type { Collection, Client, Message, PermissionResolvable } from "discord.js"

export interface Command {
  name: string
  description: string
  category: string
  aliases: string[]
  permissions: PermissionResolvable[]
  usage: string
  execute: (client: Client, message: Message, args: string[]) => Promise<void> | void
}

declare module "discord.js" {
  interface Client {
    prefix: string
    commands: Collection<string, Command>
  }
}
