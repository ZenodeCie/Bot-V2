import type { Client } from "discord.js"
import { initTempSanctions, startTempSweep } from "../utils/moderation/temp.js"

export default {
  name: "ready",
  async execute(client: Client) {
    console.log(client.guilds.cache.map(g => `${g.name} (${g.id}) ${g.vanityURLCode ? `.gg/${g.vanityURLCode}` : ""}`).join('\n'))
    console.log("done")
    console.log(`Hello, Discord !`)
    await initTempSanctions(client)
    startTempSweep(client)
  },
}
