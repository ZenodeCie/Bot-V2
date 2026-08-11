import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type Client, type Interaction, type Message } from "discord.js"
import {
  logCommandUse,
  replyError,
  requireGuild,
  resolveTarget,
} from "../../utils/moderation/helpers.js"
import { createCase, logModCase } from "../../utils/moderation/cases.js"
import { Warning } from "../../utils/moderation/schema.js"

export default {
  name: "clearwarnings",
  description: "Révoque tous les avertissements d'un utilisateur (après confirmation).",
  category: "moderation",
  aliases: ["clearwarns", "cw"],
  permissions: ["ManageMessages"],
  usage: "<@utilisateur|id>",

  async execute(client: Client, _message: Message, args: string[]) {
    logCommandUse("clearwarnings", _message)
    const guild = requireGuild(_message)
    if (!guild) return

    const resolved = await resolveTarget(client, guild, args[0] ?? "", false)
    if (!resolved.ok) return replyError(_message, "400 Bad Request", `> *${resolved.error}*`)
    const target = resolved.target

    const active = await Warning.find({ guildId: guild.id, userId: target.id, revoked: false }).lean()
    if (active.length === 0) {
      return replyError(_message, "400 Bad Request", "> *Cet utilisateur n'a aucun avertissement actif à révoquer.*")
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`modcw_confirm_${guild.id}_${_message.author.id}_${target.id}`)
        .setLabel("Confirmer")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`modcw_cancel_${guild.id}_${_message.author.id}_${target.id}`)
        .setLabel("Annuler")
        .setStyle(ButtonStyle.Secondary)
    )

    return _message.reply({
      embeds: [
        {
          title: " ",
          description:
            `# \`⚠️\` 〃 Confirmation requise\n` +
            `> *Vous vous apprêtez à révoquer **${active.length}** avertissement(s) de **${target.username}** (\`${target.id}\`).*\n` +
            `> *Chaque avertissement restera **visible** dans l'historique avec le statut **Révoqué**.*`,
          color: 0xf47c0b,
        },
      ],
      components: [row],
    })
  },

  async handleInteraction(client: Client, interaction: Interaction): Promise<boolean> {
    if (!interaction.isButton()) return false
    const match = /^modcw_(confirm|cancel)_(\d+)_(\d+)_(\d+)$/.exec(interaction.customId)
    if (!match) return false
    if (!interaction.inGuild()) return true

    const [, dir, guildId, moderatorId, userId] = match
    const guild = interaction.guild
    if (!guild) return true

    if (interaction.user.id !== moderatorId) {
      await interaction
        .reply({ content: "> *Cette interaction ne vous appartient pas.*", flags: MessageFlags.Ephemeral })
        .catch(() => undefined)
      return true
    }

    if (dir === "cancel") {
      await interaction.update({
        embeds: [
          {
            title: " ",
            description: "# `↩️` 〃 Annulé\n> *La suppression des avertissements a été annulée. Aucune modification.*",
            color: 0x95a5a6,
          },
        ],
        components: [],
      })
      return true
    }

    const warnings = await Warning.find({ guildId, userId, revoked: false })
    if (warnings.length === 0) {
      await interaction.update({
        embeds: [
          {
            title: " ",
            description: "> *Cet utilisateur n'a plus aucun avertissement actif.*",
            color: 0x95a5a6,
          },
        ],
        components: [],
      })
      return true
    }

    const moderator = { id: interaction.user.id, username: interaction.user.username }
    const target = {
      id: userId,
      username: warnings[0].username,
      globalName: warnings[0].globalName,
    }

    try {
      const warningIds = warnings.map((w) => w.warningId)
      await Warning.updateMany(
        { guildId, userId, revoked: false },
        {
          $set: {
            revoked: true,
            revokedBy: moderator.id,
            revokedAt: Date.now(),
            revokeReason: "Suppression globale des avertissements (clearwarnings)",
          },
        }
      )

      const c = await createCase({
        guild,
        target,
        moderator,
        action: "WARNINGS_CLEARED",
        reason: `Suppression de ${warnings.length} avertissement(s).`,
        metadata: { count: warnings.length, warningIds },
      })
      await logModCase(client, c)

      await interaction.update({
        embeds: [
          {
            title: " ",
            description:
              `# \`🗑️\` 〃 Avertissements révoqués\n` +
              `> ***Utilisateur :** <@${userId}>*\n` +
              `> ***Avertissements révoqués :** ${warnings.length}*\n` +
              `> ***Case :** ${c.caseIdFormatted}*\n` +
              `> *Chaque avertissement reste consultable avec le statut **Révoqué**.*`,
            color: 0xf4e00b,
          },
        ],
        components: [],
      })
    } catch (error) {
      console.error("Clearwarnings failed:", error)
      await interaction.update({
        embeds: [
          {
            title: " ",
            description: `# \`❌\` 〃 Erreur\n> *Une erreur est survenue : \`${error}\`*`,
            color: 0xe82c20,
          },
        ],
        components: [],
      })
    }
    return true
  },
}
