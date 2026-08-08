import { createModuleCommand } from "./moduleFactory.js"

export default createModuleCommand({
  name: "antijoins",
  description: "Configure la protection anti-flood de membres (raid).",
  module: "joins",
  aliases: ["antiraid", "memberraid", "flood"],
  usage: "[on|off|threshold <n>|interval <durée>|action <punition>]",
})
