import { createModuleCommand } from "./moduleFactory.js"

export default createModuleCommand({
  name: "antiselfbot",
  description: "Configure la protection anti-selfbot.",
  module: "selfbots",
  aliases: ["selfbot", "selfbots", "antiselfbots", "sb", "anti-selfbot", "anti-selfbots", "anti-sb", "antisb"],
  usage: "[on|off|threshold <n>|interval <durée>|action <punition>]",
})
