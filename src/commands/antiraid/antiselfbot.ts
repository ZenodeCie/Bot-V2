import { createModuleCommand } from "./moduleFactory.js"

export default createModuleCommand({
  name: "antiselfbot",
  description: "Configure la protection anti-selfbot.",
  module: "selfbots",
  aliases: ["selfbot", "selfbots", "antiselfbots"],
  usage: "[on|off|threshold <n>|interval <durée>|action <punition>]",
})
