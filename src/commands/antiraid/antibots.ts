import { createModuleCommand } from "./moduleFactory.js"

export default createModuleCommand({
  name: "antibots",
  description: "Configure la protection anti-bot.",
  module: "bots",
  aliases: ["bots", "antibot"],
  usage: "[on|off|threshold <n>|interval <durée>|action <punition>]",
})
