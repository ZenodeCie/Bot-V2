import type { Client, Interaction, Message, User } from "discord.js"
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js"
import type { Command } from "../../types.js"
import { colors } from "../../config.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"

const HOME_VALUE = "__home__"
const SELECT_ID = "help-category"

const E = {
  channel: { id: "1469692104589705376", name: "Channel", tag: "<:Channel:1469692104589705376>" },
  check: { id: "1469692151251341425", name: "Check", tag: "<:Check:1469692151251341425>" },
  cog: { id: "1469692155680526427", name: "Cog", tag: "<:Cog:1469692155680526427>" },
  cogUser: { id: "1469692167122325577", name: "CogUser", tag: "<:CogUser:1469692167122325577>" },
  duration: { id: "1469692196331458704", name: "Duration", tag: "<:Duration:1469692196331458704>" },
  electricStar: { id: "1469692210961322025", name: "ElectricStar", tag: "<:ElectricStar:1469692210961322025>" },
  eye: { id: "1469692577384235161", name: "Eye", tag: "<:Eye:1469692577384235161>" },
  file: { id: "1469692584959017070", name: "File", tag: "<:File:1469692584959017070>" },
  gMute: { id: "1469685636217962549", name: "g_mute", tag: "<:g_mute:1469685636217962549>" },
  notes: { id: "1469692988870623369", name: "Notes", tag: "<:Notes:1469692988870623369>" },
  party: { id: "1469693039739146435", name: "Party", tag: "<:Party:1469693039739146435>" },
  people: { id: "1469693090280505458", name: "People", tag: "<:People:1469693090280505458>" },
  permDisable: { id: "1469693096278229002", name: "PermDisable", tag: "<:PermDisable:1469693096278229002>" },
  pin: { id: "1469696535850651933", name: "Pin", tag: "<:Pin:1469696535850651933>" },
  plane: { id: "1469696552934183005", name: "Plane", tag: "<:Plane:1469696552934183005>" },
} as const

/** Icônes custom du pack modération (gris / blanc). */
const CATEGORY_EMOJIS: Record<string, { id: string; name: string; tag: string }> = {
  utils: E.cog,
  dev: E.electricStar,
  moderation: E.gMute,
  antiraid: E.permDisable,
  aeroport: E.plane,
  captcha: E.check,
  giveaway: E.party,
  logs: E.notes,
  levels: E.people,
  informationpanel: E.pin,
  "message-horaire": E.duration,
  stafflist: E.cogUser,
  rules: E.file,
  invitations: E.people,
}

const FALLBACK_EMOJI = E.channel
const HOME_EMOJI = E.pin

const CATEGORY_LABELS: Record<string, string> = {
  utils: "Utilitaires",
  dev: "Développeur",
  moderation: "Modération",
  antiraid: "Anti-raid",
  aeroport: "Aéroport",
  captcha: "Captcha",
  giveaway: "Giveaway",
  logs: "Logs",
  levels: "Niveaux",
  informationpanel: "Panneau d'information",
  "message-horaire": "Messages horaires",
  stafflist: "Liste du staff",
  rules: "Règlement",
  invitations: "Invitations",
}

function capitalize(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category.toLowerCase()] ?? capitalize(category)
}

function categoryEmoji(category: string): { id: string; name: string; tag: string } {
  return CATEGORY_EMOJIS[category.toLowerCase()] ?? FALLBACK_EMOJI
}

function toSelectEmoji(spec: { id: string; name: string }): { id: string; name: string } {
  return { id: spec.id, name: spec.name }
}

function uniqueCategories(commands: Command[]): string[] {
  return [...new Set(commands.map((c) => c.category))].sort((a, b) =>
    categoryLabel(a).localeCompare(categoryLabel(b), "fr")
  )
}

function formatPermission(permission: unknown): string {
  return typeof permission === "string" ? permission : String(permission)
}

function formatUsage(client: Client, command: Command): string {
  return `\`${client.prefix}${command.name}${command.usage ? ` ${command.usage}` : ""}\``
}

function buildHomeEmbed(client: Client, author: User): EmbedBuilder {
  const commands = [...client.commands.values()]
  const categories = uniqueCategories(commands)
  const categoryList = categories.map((category) => `\`${categoryLabel(category)}\``).join(" · ")

  return new EmbedBuilder()
    .setTitle(" ")
    .setDescription(
      `# ${E.file.tag} 〃 Help\n` +
        `> *${commands.length} commandes disponibles sur ${categories.length} catégories.*\n` +
        `> *Sélectionnez une catégorie dans le menu ci-dessous,*\n` +
        `> *ou tapez \`${client.prefix}help <commande>\` pour voir le détail d'une commande.*\n\n` +
        `> **Catégories :** ${categoryList}`
    )
    .setFooter({ text: author.tag, iconURL: author.displayAvatarURL() })
    .setColor(colors.prime ?? "#5865f2")
}

function buildCategoryEmbed(client: Client, category: string): EmbedBuilder {
  const commands = [...client.commands.values()].filter((c) => c.category === category)

  const list = commands
    .map((c) => {
      const aliases = c.aliases.length ? `\n> *Aliases: \`${c.aliases.join("`, `")}\`*` : ""
      return `- \`${client.prefix}${c.name}\`\n${c.description}`
    })
    .join("\n")

  return new EmbedBuilder()
    .setTitle(" ")
    .setDescription(`# ${categoryEmoji(category).tag} 〃 ${categoryLabel(category)}\n\n${list}`)
    .setColor(colors.prime ?? "#5865f2")
}

function buildCommandEmbed(client: Client, command: Command): EmbedBuilder {
  const fields = [
    `> ***Description:** ${command.description}*`,
    `> ***Catégorie:** \`${categoryLabel(command.category)}\`*`,
  ]

  if (command.aliases.length) {
    fields.push(`> ***Aliases:** \`${command.aliases.join("`, `")}\`*`)
  }
  if (command.permissions.length) {
    fields.push(`> ***Permissions:** \`${command.permissions.map(formatPermission).join("`, `")}\`*`)
  }
  fields.push(`> ***Usage:** ${formatUsage(client, command)}*`)

  return new EmbedBuilder()
    .setTitle(" ")
    .setDescription(`# ${E.eye.tag} 〃 ${command.name}\n\n${fields.join("\n")}`)
    .setColor(colors.prime ?? "#5865f2")
}

function buildCategorySelect(client: Client): ActionRowBuilder<StringSelectMenuBuilder> {
  const commands = [...client.commands.values()]
  const categories = uniqueCategories(commands)

  const select = new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder("Sélectionnez une catégorie...")
    .addOptions(
      {
        label: "Accueil",
        emoji: toSelectEmoji(HOME_EMOJI),
        description: "Retourner à la page d'accueil",
        value: HOME_VALUE,
      },
      ...categories.map((category) => {
        const count = commands.filter((c) => c.category === category).length
        return {
          label: categoryLabel(category),
          emoji: toSelectEmoji(categoryEmoji(category)),
          description: `${count} commande${count > 1 ? "s" : ""}`,
          value: category,
        }
      })
    )

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)
}

export async function handleInteraction(_client: Client, _interaction: Interaction): Promise<boolean> {
  if (!_interaction.isStringSelectMenu()) return false
  if (_interaction.customId !== SELECT_ID) return false

  const author = _interaction.message?.interaction?.user
  if (author && _interaction.user.id !== author.id) {
    await _interaction.reply({
      content: "> *Cette aide est réservée à son auteur.*",
      ephemeral: true,
    })
    return true
  }

  const value = _interaction.values[0]
  const embed = value === HOME_VALUE ? buildHomeEmbed(_client, _interaction.user) : buildCategoryEmbed(_client, value)
  await _interaction.update({ embeds: [embed] })
  return true
}

export default {
  name: "help",
  description: "Affiche l'aide et les informations sur les commandes du bot.",
  category: "utils",
  aliases: ["h", "aide"],
  permissions: [],
  usage: "[commande|alias]",
  slash: [
    { name: "commande", description: "Nom ou alias d'une commande", type: ApplicationCommandOptionType.String, required: false },
  ],
  handleInteraction,
  async execute(_client: Client, _message: Message, _args: string[]) {
    console.log(`Command help used by ${_message.author.tag} (${_message.author.id}) in the guild ${_message.guild?.name} (${_message.guild?.id}${_message.guild?.vanityURLCode ? ` / .gg/${_message.guild?.vanityURLCode}` : ""})`)

    if (_args.length) {
      const query = _args[0].toLowerCase()
      const command =
        _client.commands.get(query) ??
        _client.commands.find((c) => c.aliases.includes(query))

      if (!command) {
        return _message.reply({
          embeds: [buildErrorEmbed("404 Not Found", `> *Aucune commande nommée \`${query}\`.*`)],
        })
      }
      return _message.reply({ embeds: [buildCommandEmbed(_client, command)] })
    }

    const row = buildCategorySelect(_client)
    await _message.reply({ embeds: [buildHomeEmbed(_client, _message.author)], components: [row] })
  },
}
