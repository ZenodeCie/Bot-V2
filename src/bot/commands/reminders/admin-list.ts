import { type Client, type Message } from "discord.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { remindersStore } from "../../utils/reminders/storage.js"

export default {
  name: "admin-list",
  description: "Lister tous les rappels du serveur (administrateur).",
  category: "reminders",
  aliases: [],
  permissions: ["Administrator"],
  usage: "admin-list",
  async execute(client: Client, message: Message) {
    const guild = requireGuild(message)
    if (!guild) return

    const mine = (await remindersStore().listAll()).filter((record) => record.guildId === guild.id)
    if (mine.length === 0) {
      await message.reply({ embeds: [buildModEmbed("pin", "Rappels du serveur", "> *Aucun rappel enregistré.*")] })
      return
    }

    const lines = mine.map(
      (record) =>
        `> **\`${record.id}\`** — <@${record.authorId}> — <t:${Math.floor(record.nextAt / 1000)}:f> — ${record.paused ? "*en pause*" : "**actif**"}${record.lastError ? ` — *erreur : ${record.lastError}*` : ""}`
    )
    await message.reply({
      embeds: [buildModEmbed("pin", `Rappels du serveur (${mine.length})`, lines.join("\n"), "#57F287")],
    })
  },
}
