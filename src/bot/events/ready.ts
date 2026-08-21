import type { Client } from "discord.js"
import { initGiveaways, startGiveawaySweep } from "../utils/giveaway/engine.js"
import { initInformationPanels, startInformationPanelSweep } from "../utils/informationpanel/engine.js"
import { initInviteCache } from "../utils/invitations/engine.js"
import { initMessageHoraire, startMessageHoraireSweep } from "../utils/message-horaire/engine.js"
import { initTempSanctions, startTempSweep } from "../utils/moderation/temp.js"
import { initStaffLists } from "../utils/stafflist/engine.js"
import { registerSlashCommands } from "../utils/slash.js"

export default {
  name: "ready",
  async execute(client: Client) {
    const lines = client.guilds.cache.map((g) => `${g.name} (${g.id}) ${g.vanityURLCode ? `.gg/${g.vanityURLCode}` : ""}`)
    if (lines.length) console.log(lines.join("\n"))
    console.log("done")
    console.log(`Hello, Discord ! Bot ready / connecté / logged in as ${client.user?.tag}`)
    try {
      await registerSlashCommands(client)
    } catch (error) {
      console.error("Failed to register slash commands:", error)
    }
    if (client.enabledModules.has("Moderation")) {
      await initTempSanctions(client)
      startTempSweep(client)
    }
    if (client.enabledModules.has("Giveaway")) {
      await initGiveaways(client)
      startGiveawaySweep(client)
    }
    if (client.enabledModules.has("InformationPanel")) {
      await initInformationPanels(client)
      startInformationPanelSweep(client)
    }
    if (client.enabledModules.has("Message-Horaire")) {
      await initMessageHoraire(client)
      startMessageHoraireSweep(client)
    }
    if (client.enabledModules.has("StaffList")) {
      await initStaffLists(client)
    }
    if (client.enabledModules.has("Invitations")) {
      await initInviteCache(client)
    }
  },
}
