import type { Client } from "discord.js"

export default {
  name: "clientReady",
  async execute(_client: Client) {
    console.log(_client.guilds.cache.map(g => `${g.name} (${g.id}) ${g.vanityURLCode ? `.gg/${g.vanityURLCode}` : ""}`).join('\n'))
    console.log("done")
    console.log(`Hello, Discord !`)
  },
}
