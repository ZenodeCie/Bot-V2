import type { Client, Interaction } from "discord.js"
import { MessageFlags } from "discord.js"
import buildErrorEmbed from "../utils/errorEmbed.js"
import { argsFromSlash, asCommandMessage, resolveSlashCommand } from "../utils/slash.js"

export default {
  name: "interactionCreate",
  async execute(client: Client, interaction: Interaction) {
    if (interaction.isChatInputCommand()) {
      const command = resolveSlashCommand(client, interaction)
      if (!command) return

      if (command.permissions?.length) {
        const missing = interaction.memberPermissions?.missing(command.permissions)
        if (missing?.length) {
          return interaction.reply({
            embeds: [buildErrorEmbed("401 Unauthorized", "> *You are not authorized to execute this command.*")],
            flags: MessageFlags.Ephemeral,
          })
        }
      }

      const args = command.slashArgs?.(interaction) ?? argsFromSlash(interaction, command.slash)
      const message = asCommandMessage(interaction, command.name, args)
      try {
        await command.execute(client, message, args)
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "> *Cette commande est réservée.*", flags: MessageFlags.Ephemeral }).catch(() => undefined)
        }
      } catch (error) {
        console.error(`Erreur lors de l'exécution de /${command.name}:`, error)
        const payload = {
          embeds: [buildErrorEmbed("500 Internal Server Error", "> *An error occurred while executing this command.*\n```\n" + error + "\n```")],
        }
        if (interaction.replied || interaction.deferred) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral })
        else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
      }
      return
    }

    for (const handler of client.interactions.values()) {
      try {
        if (await handler(client, interaction)) return
      } catch (error) {
        console.error(`Erreur lors du traitement d'une interaction:`, error)
      }
    }
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try {
        if (interaction.isMessageComponent()) {
          await interaction.deferUpdate()
        } else {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        }
      } catch {
        /* fallback best-effort */
      }
    }
  },
}
