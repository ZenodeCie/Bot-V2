const BOT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

export function isValidBotId(botId: string): boolean {
  return BOT_ID_PATTERN.test(botId) && botId.length > 0 && botId.length <= 128
}

export function assertValidBotId(botId: string): string {
  if (!isValidBotId(botId)) {
    throw new Error(`Invalid bot_id: ${JSON.stringify(botId)}`)
  }
  return botId
}

/** PM2 process name = bot_id normalized (core historical contract). */
export function toPm2Name(botId: string): string {
  return String(botId)
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .toLowerCase()
    .slice(0, 100)
}

export const HOST_AGENT_PM2_NAME = "zenode-vm-host"
