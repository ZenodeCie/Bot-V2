import type { Client, VoiceState } from "discord.js"
import { handleVoiceStateUpdate } from "../../utils/join2create/engine.js"

export default {
  name: "voiceStateUpdate",
  async execute(client: Client, oldState: VoiceState, newState: VoiceState) {
    await handleVoiceStateUpdate(client, oldState, newState)
  },
}