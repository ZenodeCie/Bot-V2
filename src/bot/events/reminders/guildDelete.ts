import type { Client, Guild } from "discord.js"
import { remindersStore } from "../../utils/reminders/storage.js"
import { clearGuildTimers } from "../../utils/remindersEngine.js"

export default {
  name: "guildDelete",
  async execute(client: Client, guild: Guild) {
    // Les timers sont retirés d'abord : un rappel encore armé enverrait dans un
    // salon d'un serveur dont le bot n'a plus l'accès.
    clearGuildTimers(guild.id)
    try {
      await remindersStore().removeGuild(guild.id)
      console.log(`Rappels: données purgées pour le salon ${guild.id}.`)
    } catch (error) {
      console.error(`Rappels: purge du salon ${guild.id} impossible:`, error instanceof Error ? error.message : String(error))
    }
    void client
  },
}
