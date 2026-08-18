import type { ConfigStore } from "./configStore.js"
import type { HostEnv } from "./env.js"
import type { HostLogger } from "./logger.js"
import type { Pm2Manager } from "./pm2Manager.js"
import type { CoreRestClient } from "./restClient.js"
import type { CoreWsClient } from "./wsClient.js"

export interface HostContext {
  env: HostEnv
  log: HostLogger
  ws: CoreWsClient
  rest: CoreRestClient
  pm2: Pm2Manager
  store: ConfigStore
}

export async function reportBotStatus(
  ctx: HostContext,
  botId: string,
  status: "online" | "offline" | "starting" | "error" | "stopping"
): Promise<void> {
  const timestamp = new Date().toISOString()
  if (status !== "stopping") {
    ctx.ws.send({
      type: "bot_status",
      bot_id: botId,
      status,
      vm_host: ctx.env.vmHost,
      timestamp,
    })
  }
  try {
    await ctx.rest.postStatus(botId, status)
  } catch (error) {
    ctx.log.warn(`POST /status ${botId} ${status} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
