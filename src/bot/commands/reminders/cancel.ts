import { ApplicationCommandOptionType, type Client, type Message } from "discord.js"
import { buildModEmbed, requireGuild } from "../../utils/moderation/helpers.js"
import { isReminderId } from "../../utils/reminders/schema.js"
import { remindersStore } from "../../utils/reminders/storage.js"
import { rescheduleReminder } from "../../utils/remindersEngine.js"

export default {
  name: "cancel",
  description: "Annuler un de vos rappels.",
  category: "reminders",
  aliases: [],
  permissions: [],
  usage: "cancel <id>",
  slash: [
    {
      name: "id",
      description: "Identifiant du rappel (copié depuis /rappel list)",
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
    if (record.authorId !== message.author.id) {
      await message.reply({
        embeds: [buildModEmbed("cancel", "Pas le vôtre", "> *Seul l'auteur du rappel peut l'annuler.*")],
      })
      return
    }

    await store.remove(guild.id, id)
    // Le rappel n'existe plus : `rescheduleReminder` désarme exactement ce timer.
    // Effacer tous les timers du salon laisserait les autres rappels sans
    // déclencheur jusqu'au prochain redémarrage.
    await rescheduleReminder(client, guild.id, id)
    await message.reply({
      embeds: [buildModEmbed("check", "Rappel annulé", `> *\`${id}\` a été supprimé.*`)],
    })
  },
}
