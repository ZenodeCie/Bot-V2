import { createModuleCommand } from "./moduleFactory.js"

export default createModuleCommand({
  name: "antiemojis",
  description: "Configure la protection anti-émoji.",
  module: "emojis",
  aliases: ["emojis", "antiemoji"],
  usage: "[on|off|threshold <n>|interval <durée>|action <punition>]",
})
