import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Client,
  type Guild,
  type Interaction,
  type ModalSubmitInteraction,
} from "discord.js"
import config from "../../../config.js"
import { appEmojiComponent, appEmojiHeading, appEmojiText } from "../../appEmojis.js"
import buildErrorEmbed from "../../errorEmbed.js"
import { Guild as GuildModel } from "../../initData.js"
import { COMPONENTS_V2_FLAGS, CONTAINER_ACCENT } from "../../giveaway/notice.js"
import { CFG_PREFIX_BTN, CFG_PREFIX_MODAL } from "../constants.js"

const MAX_PREFIX_LENGTH = 10

export async function buildGeneralContainer(_client: Client, guild: Guild): Promise<ContainerBuilder[]> {
  let current = config.prefix
  try {
    const data = await GuildModel.findOne({ guildId: guild.id }).lean()
    if (data?.prefix) current = data.prefix
  } catch {
    /* ignore */
  }

  const container = new ContainerBuilder().setAccentColor(CONTAINER_ACCENT)
  container.addTextDisplayComponents((t) => t.setContent(appEmojiHeading("cog", "Configuration générale")))
  container.addSeparatorComponents((s) => s.setSpacing(1))
  container.addTextDisplayComponents((t) =>
    t.setContent(
      `> *Réglages globaux du bot sur ce serveur.*\n\n` +
        `> ${appEmojiText("settings")} **Préfixe actuel :** \`${current}\`\n` +
        `> *Le préfixe s'applique aux commandes texte (ex. \`${current}help\`).*` +
        `\n\n> *Les commandes slash (\`/config\`, \`/help\`, etc.) ne dépendent pas du préfixe.*`
    )
  )
  container.addSeparatorComponents((s) => s.setDivider(true))
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(CFG_PREFIX_BTN)
        .setLabel("Modifier le préfixe")
        .setEmoji(appEmojiComponent("settings"))
        .setStyle(ButtonStyle.Primary)
    )
  )
  return [container]
}

function buildPrefixModal(current: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(CFG_PREFIX_MODAL)
    .setTitle("Modifier le préfixe")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("prefix")
          .setLabel("Nouveau préfixe")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(MAX_PREFIX_LENGTH)
          .setPlaceholder(current)
          .setValue(current)
      )
    )
}

export async function handleGeneralInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (interaction.isButton() && interaction.customId === CFG_PREFIX_BTN) {
    if (!interaction.inGuild()) return false
    let current = config.prefix
    try {
      const data = await GuildModel.findOne({ guildId: interaction.guildId }).lean()
      if (data?.prefix) current = data.prefix
    } catch {
      /* ignore */
    }
    await interaction.showModal(buildPrefixModal(current))
    return true
  }

  if (interaction.isModalSubmit() && interaction.customId === CFG_PREFIX_MODAL) {
    return handlePrefixModal(interaction)
  }

  return false
}

async function handlePrefixModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.inGuild()) return false
  const newPrefix = interaction.fields.getTextInputValue("prefix").trim()
  if (!newPrefix) {
    await interaction.reply({
      embeds: [buildErrorEmbed("400 Bad Request", "> *Le préfixe ne peut pas être vide.*")],
      ephemeral: true,
    })
    return true
  }
  if (newPrefix.length > MAX_PREFIX_LENGTH) {
    await interaction.reply({
      embeds: [buildErrorEmbed("400 Bad Request", `> *Le préfixe ne peut pas dépasser ${MAX_PREFIX_LENGTH} caractères.*`)],
      ephemeral: true,
    })
    return true
  }

  try {
    await GuildModel.findOneAndUpdate(
      { guildId: interaction.guildId },
      { $set: { prefix: newPrefix } },
      { upsert: true, new: true }
    )
  } catch (error) {
    console.error("Failed to persist guild prefix:", error)
    await interaction.reply({
      embeds: [buildErrorEmbed("500 Internal Server Error", "> *Impossible d'enregistrer le préfixe.*")],
      ephemeral: true,
    })
    return true
  }

  await interaction.reply({
    content: `${appEmojiText("check")} Préfixe mis à jour : \`${newPrefix}\``,
    ephemeral: true,
  })
  return true
}

export { COMPONENTS_V2_FLAGS }
