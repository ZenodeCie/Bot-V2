import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type Client,
  type InteractionReplyOptions,
  type Message,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js"
import type { Command, SlashOption } from "../types.js"

/** Standalone slash commands (not nested under a module). */
export const ROOT_SLASH_NAMES = new Set(["help", "ping", "prefix"])

export const SLASH_GROUPS: Record<string, { name: string; description: string }> = {
  antiraid: { name: "anti-raid", description: "Configuration et outils anti-raid" },
  moderation: { name: "moderation", description: "Commandes de modération" },
  utils: { name: "utilities", description: "Utilitaires" },
  dev: { name: "dev", description: "Commandes développeur" },
  tickets: { name: "ticket", description: "Système de tickets" },
  captcha: { name: "captcha", description: "Vérification anti-bot" },
  logs: { name: "logs", description: "Journal des événements" },
  giveaway: { name: "giveaway", description: "Giveaways" },
  levels: { name: "levels", description: "Niveaux et XP" },
  aeroport: { name: "aeroport", description: "Messages d'arrivée et de départ" },
  rules: { name: "rules", description: "Règlement interactif" },
  stafflist: { name: "stafflist", description: "Liste du staff" },
  informationpanel: { name: "infopanel", description: "Panneau d'informations" },
  invitations: { name: "invitations", description: "Suivi des invitations" },
  "message-horaire": { name: "message-horaire", description: "Messages programmés" },
}

export function slashSubcommandName(command: Command): string {
  return command.slashName ?? command.name
}

export function argsFromSlash(interaction: ChatInputCommandInteraction, options: SlashOption[] = []): string[] {
  const args: string[] = []
  for (const option of options) {
    switch (option.type) {
      case ApplicationCommandOptionType.User: {
        const user = interaction.options.getUser(option.name)
        if (user) args.push(user.id)
        break
      }
      case ApplicationCommandOptionType.Channel: {
        const channel = interaction.options.getChannel(option.name)
        if (channel) args.push(`<#${channel.id}>`)
        break
      }
      case ApplicationCommandOptionType.Role: {
        const role = interaction.options.getRole(option.name)
        if (role) args.push(role.id)
        break
      }
      case ApplicationCommandOptionType.Integer:
      case ApplicationCommandOptionType.Number: {
        const value = interaction.options.get(option.name)?.value
        if (value !== undefined && value !== null) args.push(String(value))
        break
      }
      case ApplicationCommandOptionType.Boolean: {
        const value = interaction.options.getBoolean(option.name)
        if (value !== null) args.push(value ? "on" : "off")
        break
      }
      default: {
        const value = interaction.options.getString(option.name)
        if (value) args.push(value)
      }
    }
  }
  return args
}

export function asCommandMessage(
  interaction: ChatInputCommandInteraction,
  commandName: string,
  args: string[]
): Message {
  const reply = async (options: string | InteractionReplyOptions) => {
    const payload = typeof options === "string" ? { content: options } : options
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({ ...payload, fetchReply: true })
    }
    return interaction.reply({ ...payload, fetchReply: true })
  }

  return {
    author: interaction.user,
    member: interaction.guild?.members.cache.get(interaction.user.id) ?? interaction.member,
    guild: interaction.guild,
    channel: interaction.channel,
    createdTimestamp: interaction.createdTimestamp,
    content: `${commandName} ${args.join(" ")}`.trim(),
    mentions: {
      users: { first: () => interaction.options.resolved?.users?.first() ?? null },
      channels: { first: () => interaction.options.resolved?.channels?.first() ?? null },
      roles: { first: () => interaction.options.resolved?.roles?.first() ?? null },
    },
    reply,
  } as unknown as Message
}

function toApiOption(option: SlashOption) {
  return {
    name: option.name,
    description: option.description.slice(0, 100),
    type: option.type,
    required: option.required ?? false,
    ...(option.choices ? { choices: option.choices } : {}),
    ...(option.minValue !== undefined ? { min_value: option.minValue } : {}),
    ...(option.maxValue !== undefined ? { max_value: option.maxValue } : {}),
  }
}

function permissionsPayload(commands: Command[]): string | null {
  if (!commands.length) return null
  const serialized = commands.map((command) =>
    command.permissions.length ? String(PermissionsBitField.resolve(command.permissions)) : null
  )
  const first = serialized[0]
  if (serialized.every((value) => value === first)) return first
  return null
}

export function toSlashData(command: Command): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return {
    name: command.name,
    description: command.description.slice(0, 100),
    type: ApplicationCommandType.ChatInput,
    options: (command.slash ?? []).map(toApiOption) as RESTPostAPIChatInputApplicationCommandsJSONBody["options"],
    dm_permission: false,
    default_member_permissions: permissionsPayload([command]),
  }
}

function toSubcommand(command: Command): NonNullable<RESTPostAPIChatInputApplicationCommandsJSONBody["options"]>[number] {
  return {
    type: ApplicationCommandOptionType.Subcommand,
    name: slashSubcommandName(command),
    description: command.description.slice(0, 100),
    options: (command.slash ?? []).map(toApiOption),
  } as NonNullable<RESTPostAPIChatInputApplicationCommandsJSONBody["options"]>[number]
}

function partitionCommands(commands: Command[]): { root: Command[]; grouped: Map<string, Command[]> } {
  const root: Command[] = []
  const grouped = new Map<string, Command[]>()

  for (const command of commands) {
    if (ROOT_SLASH_NAMES.has(command.name) || !SLASH_GROUPS[command.category]) {
      root.push(command)
      continue
    }
    const bucket = grouped.get(command.category) ?? []
    bucket.push(command)
    grouped.set(command.category, bucket)
  }

  return { root, grouped }
}

export function resolveSlashCommand(client: Client, interaction: ChatInputCommandInteraction): Command | undefined {
  const sub = interaction.options.getSubcommand(false)
  if (sub) {
    const grouped = [...client.commands.values()].find((command) => {
      if (ROOT_SLASH_NAMES.has(command.name)) return false
      const group = SLASH_GROUPS[command.category]
      if (!group) return false
      return group.name === interaction.commandName && slashSubcommandName(command) === sub
    })
    if (grouped) return grouped
  }
  return client.commands.get(interaction.commandName)
}

export function buildSlashBody(commands: Command[]): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const { root, grouped } = partitionCommands(commands)
  const body: RESTPostAPIChatInputApplicationCommandsJSONBody[] = root.map(toSlashData)

  for (const [category, bucket] of grouped) {
    const group = SLASH_GROUPS[category]
    if (!group) continue
    const sorted = [...bucket].sort((a, b) => slashSubcommandName(a).localeCompare(slashSubcommandName(b)))
    if (sorted.length > 25) {
      console.warn(`Slash group /${group.name} has ${sorted.length} subcommands (Discord max 25) — extra commands skipped`)
    }
    body.push({
      name: group.name,
      description: group.description.slice(0, 100),
      type: ApplicationCommandType.ChatInput,
      options: sorted.slice(0, 25).map(toSubcommand),
      dm_permission: false,
      default_member_permissions: permissionsPayload(sorted),
    })
  }

  return body
}

export async function registerSlashCommands(client: Client): Promise<void> {
  if (!client.application) return
  const body = buildSlashBody([...client.commands.values()])
  await client.application.commands.set(body)
  for (const guild of client.guilds.cache.values()) {
    await guild.commands.set(body)
  }
  console.log(`Slash commands registered (${body.length})`)
}
