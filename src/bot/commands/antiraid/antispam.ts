import { createModuleCommand } from "./moduleFactory.js"

export default createModuleCommand({
  name: "antispam",
  description: "Configure la protection anti-spam.",
  module: "spam",
  aliases: ["spam"],
  usage: "[on|off|threshold <n>|interval <durée>|action <punition>]",
})
