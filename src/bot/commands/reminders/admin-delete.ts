import { ApplicationCommandOptionType, type Client, type Message } from "discord.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { isReminderId } from "../../utils/reminders/schema.js"
import { remindersStore } from "../../utils/reminders/storage.js"
import { clearGuildTimers } from "../../utils/remindersEngine.js"

export default {
  name: "admin-delete",
  description: "Supprimer un rappel du serveur, quel qu'en soit l'auteur (administrateur).",
  category: "reminders",
  aliases: [],
  permissions: ["Administrator"],
  usage: "admin-delete <id>",
  slash: [
    {
      name: "id",
      description: "Identifiant du rappel",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],
  async execute(client: Client, message: Message, args: string[]) {
    const guild = requireGuild(message)
    if (!guild) return

    const id = (args[0] ?? "").trim()
    if (!isReminderId(id)) {
      await message.reply({
        embeds: [buildModEmbed("cancel", "Identifiant invalide", "> *Cet identifiant de rappel n'existe pas.*")],
      })
      return
    }

    const store = remindersStore()
    const record = await store.get(guild.id, id)
    if (!record) {
      await message.reply({ embeds: [buildModEmbed("cancel", "Rappel introuvable", "> *Ce rappel n'existe plus.*")] })
      return
    }

    await store.remove(guild.id, id)
    clearGuildTimers(guild.id)
    await message.reply({
      embeds: [buildModEmbed("check", "Rappel supprimé", `> *\`${id}\` (de <@${record.authorId}>) a été supprimé.*`)],
    })
  },
}
