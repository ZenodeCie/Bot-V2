import type { Client, Interaction, Message, User } from "discord.js"
import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js"
import type { Command } from "../../types.js"
import buildErrorEmbed from "../../utils/errorEmbed.js"

const HOME_VALUE = "__home__"
const SELECT_ID = "help-category"

function formatPermission(permission: unknown): string {
  return typeof permission === "string" ? permission : String(permission)
}

function formatUsage(client: Client, command: Command): string {
  return `\`${client.prefix}${command.name}${command.usage ? ` ${command.usage}` : ""}\``
}

function buildHomeEmbed(client: Client, author: User): EmbedBuilder {
  const commands = [...client.commands.values()]
  const categories = [...new Set(commands.map((c) => c.category))]

  const sections = categories.map((category) => {
    const categoryCommands = commands.filter((c) => c.category === category)
    const list = categoryCommands.map((c) => `\`${c.name}\` — ${c.description}`).join("\n> ")
    return `### \`${category}\`\n> ${list}`
  })

  return new EmbedBuilder()
    .setTitle(" ")
    .setDescription(
      `# \`📚\` 〃 Help\n` +
        `> *${commands.length} commandes disponibles sur ${categories.length} catégories.*\n` +
        `> *Sélectionnez une catégorie dans le menu ci-dessous,*\n` +
        `> *ou tapez \`${client.prefix}help <commande>\` pour voir le détail d'une commande.*\n\n`
    )
    .setFooter({ text: author.tag, iconURL: author.displayAvatarURL() })
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
    .setDescription(`# \`🗂️\` 〃${category}\n\n${list}`)
}

function buildCommandEmbed(client: Client, command: Command): EmbedBuilder {
  const fields = [
    `> ***Description:** ${command.description}*`,
    `> ***Catégorie:** \`${command.category}\`*`,
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
    .setDescription(`# \`🔍\` 〃 ${command.name}\n\n${fields.join("\n")}`)
}

function buildCategorySelect(client: Client): ActionRowBuilder<StringSelectMenuBuilder> {
  const commands = [...client.commands.values()]
  const categories = [...new Set(commands.map((c) => c.category))]

  const select = new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder("Sélectionnez une catégorie...")
    .addOptions(
      {
        label: "Accueil",
        emoji: "🏠",
        description: "Retourner à la page d'accueil",
        value: HOME_VALUE,
      },
      ...categories.map((category) => {
        const count = commands.filter((c) => c.category === category).length
        return {
          label: category,
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
