import type { Client, Message } from "discord.js"
import { requireGuild, buildModEmbed } from "../../utils/moderation/helpers.js"

export default {
  name: "list",
  description: "Lister les panels de rôles-réactions du serveur.",
  category: "reactionroles",
  aliases: [],
  permissions: ["Administrator"],
  usage: "list",
  async execute(client: Client, message: Message) {
    const guild = requireGuild(message)
    if (!guild) return
    const panels = await client.reactionroles.getPanels(guild.id)
    if (panels.length === 0) {
      await message.reply({
        embeds: [buildModEmbed("people", "Rôles-réactions", "> *Aucun panel. Créez-en un avec `/rr create`.*")],
      })
      return
    }
    const lines = panels.map((panel) => {
      const modeLabels: Record<string, string> = {
        normal: "Normal",
        unique: "Unique",
        verify: "Vérification",
        drop: "Drop",
        reversed: "Inversé",
      }
      return (
        `> **${panel.name || panel.id}** — \`${modeLabels[panel.mode] ?? panel.mode}\` — ${panel.enabled ? "**activé**" : "*désactivé*"}\n` +
        `> *${panel.entries.length} entrée${panel.entries.length > 1 ? "s" : ""} · publié : ${panel.messageId ? `<#${panel.channelId}>` : "non"} · \`id ${panel.id}\`*`
      )
    })
    await message.reply({
      embeds: [buildModEmbed("people", `Rôles-réactions — ${panels.length}`, lines.join("\n\n"), "#57F287")],
    })
  },
}