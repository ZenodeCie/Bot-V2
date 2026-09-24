import { MessageFlags, type Client, type Interaction } from "discord.js"
import { resolveGuildMember } from "./engine.js"

/**
 * Interactions membre des panels publiés : boutons `rrb:{panelId}:{entryId}`
 * et menus `rrs:{panelId}:{batch}`. Aucune permission requise.
 */

export const RR_BUTTON_PREFIX = "rrb:"
export const RR_SELECT_PREFIX = "rrs:"

async function replyEphemeral(interaction: Interaction, content: string): Promise<void> {
  if (!interaction.isRepliable()) return
  await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined)
}

export async function handleMemberInteraction(client: Client, interaction: Interaction): Promise<boolean> {
  if (interaction.isButton() && interaction.customId.startsWith(RR_BUTTON_PREFIX)) {
    const parts = interaction.customId.split(":")
    const panelId = parts[1]
    const entryId = parts[2]
    if (!panelId || !entryId) {
      await replyEphemeral(interaction, "> *Ce bouton est invalide.*")
      return true
    }
    if (!interaction.inGuild() || !interaction.guild) {
      await replyEphemeral(interaction, "> *Utilisable uniquement dans un serveur.*")
      return true
    }
    const panel = await client.reactionroles.getPanel(interaction.guild.id, panelId)
    if (!panel) {
      await replyEphemeral(interaction, "> *Ce panel n'existe plus.*")
      return true
    }
    const member = await resolveGuildMember(interaction.guild, interaction.user.id)
    if (!member) {
      await replyEphemeral(interaction, "> *Impossible de récupérer votre membre sur ce serveur.*")
      return true
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined)
    await client.reactionroles.applyButton(interaction.guild, member, panel, entryId, interaction)
    return true
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(RR_SELECT_PREFIX)) {
    const panelId = interaction.customId.split(":")[1]
    if (!panelId) {
      await replyEphemeral(interaction, "> *Ce menu est invalide.*")
      return true
    }
    if (!interaction.inGuild() || !interaction.guild) {
      await replyEphemeral(interaction, "> *Utilisable uniquement dans un serveur.*")
      return true
    }
    const panel = await client.reactionroles.getPanel(interaction.guild.id, panelId)
    if (!panel) {
      await replyEphemeral(interaction, "> *Ce panel n'existe plus.*")
      return true
    }
    const member = await resolveGuildMember(interaction.guild, interaction.user.id)
    if (!member) {
      await replyEphemeral(interaction, "> *Impossible de récupérer votre membre sur ce serveur.*")
      return true
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined)
    await client.reactionroles.applySelect(interaction.guild, member, panel, interaction.values, interaction)
    return true
  }

  return false
}
