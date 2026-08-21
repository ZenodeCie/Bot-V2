import { asBotConfig, parseApplicationEmojis, type BotConfig } from "../shared/botConfig.js"

export type BotLifecycleStatus = "online" | "offline" | "starting" | "error"
export type BotRestStatus = BotLifecycleStatus | "stopping"
export type Pm2ProcessStatus = "online" | "starting" | "stopped" | "errored"
export type ConfigUploadAction = "create" | "update"
export type BotCommandAction = "start" | "stop" | "restart" | "delete"

export interface WelcomeMessage {
  type: "welcome"
  message: string
  vm_type?: string
  timestamp?: string
}

export interface PongMessage {
  type: "pong"
  timestamp?: string
}

export interface PingInboundMessage {
  type: "ping"
  vm_host?: string
}

export interface ErrorInboundMessage {
  type: "error"
  message?: string
  error?: string
}

export interface BotCommandMessage {
  type: "bot_command"
  bot_id: string
  action: BotCommandAction
  config?: BotConfig
  timestamp?: string
  vm_host?: string
}

export interface ConfigUploadMessage {
  type: "config_upload"
  bot_id: string
  config: BotConfig
  action: ConfigUploadAction
  vm_host?: string
}

export interface BotLogsRequestMessage {
  type: "bot_logs_request"
  bot_id: string
  lines?: number
  request_id: string
  vm_host?: string
}

export interface UnknownInboundMessage {
  type: "unknown"
  originalType: string
  payload: Record<string, unknown>
}

export type InboundMessage =
  | WelcomeMessage
  | PongMessage
  | PingInboundMessage
  | ErrorInboundMessage
  | BotCommandMessage
  | ConfigUploadMessage
  | BotLogsRequestMessage
  | UnknownInboundMessage

export interface BotStatusMessage {
  type: "bot_status"
  bot_id: string
  status: BotLifecycleStatus
  vm_host: string
  timestamp: string
}

export interface ConfigReceivedMessage {
  type: "config_received"
  bot_id: string
  status: "success" | "error"
  message: string
  vm_host: string
}

export interface BotLogsResponseMessage {
  type: "bot_logs_response"
  request_id: string
  bot_id: string
  stdout: string
  stderr: string
  error: string | null
}

export interface PingOutboundMessage {
  type: "ping"
  vm_host: string
}

export interface PongOutboundMessage {
  type: "pong"
  timestamp: string
  vm_host: string
}

export type OutboundMessage =
  | BotStatusMessage
  | ConfigReceivedMessage
  | BotLogsResponseMessage
  | PingOutboundMessage
  | PongOutboundMessage

export interface VmStatsBotEntry {
  bot_id: string
  status: BotLifecycleStatus
}

export interface VmStatsPayload {
  vm_host: string
  bots: VmStatsBotEntry[]
  stats: {
    total: number
    active: number
    offline: number
    error: number
  }
}

export interface RealStatusPayload {
  pm2_online: boolean
  discord_ready: boolean
  discord_ready_state: string
  really_online: boolean
  last_status_update: number
  pm2_status: Pm2ProcessStatus
  memory: number
  cpu: number
  uptime: number
  restart_time: number
  ping: number
  vm: string
  vm_host: string
  timestamp: number
  guilds: number
  users: number
}

export interface BotStatusRestPayload {
  status: BotRestStatus
  vm_host: string
}

export interface HostedBotInfo {
  bot_id: string
  vm_host?: string
  status?: string
  config?: BotConfig
}

const BOT_COMMAND_ACTIONS: ReadonlySet<string> = new Set(["start", "stop", "restart", "delete"])
const CONFIG_UPLOAD_ACTIONS: ReadonlySet<string> = new Set(["create", "update"])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function mergeConfig(botId: string, value: unknown): BotConfig | undefined {
  const parsed = asBotConfig(value)
  if (parsed) {
    const application_emojis = parseApplicationEmojis(parsed.application_emojis)
    return application_emojis
      ? { ...parsed, bot_id: parsed.bot_id || botId, application_emojis }
      : { ...parsed, bot_id: parsed.bot_id || botId }
  }
  const record = asRecord(value)
  if (!record) return undefined
  const application_emojis = parseApplicationEmojis(record.application_emojis)
  const config: BotConfig = { ...record, bot_id: asString(record.bot_id) ?? botId }
  if (application_emojis) config.application_emojis = application_emojis
  else delete config.application_emojis
  return config
}

export function parseInboundMessage(raw: unknown): InboundMessage {
  const record = asRecord(raw)
  if (!record || typeof record.type !== "string") {
    return { type: "unknown", originalType: "", payload: record ?? {} }
  }

  const type = record.type
  switch (type) {
    case "welcome":
      return {
        type: "welcome",
        message: asString(record.message) ?? "",
        vm_type: asString(record.vm_type),
        timestamp: asString(record.timestamp),
      }
    case "pong":
      return {
        type: "pong",
        timestamp: asString(record.timestamp),
      }
    case "ping":
      return {
        type: "ping",
        vm_host: asString(record.vm_host),
      }
    case "error":
      return {
        type: "error",
        message: asString(record.message),
        error: asString(record.error),
      }
    case "bot_command": {
      const botId = asString(record.bot_id) ?? ""
      const action = asString(record.action) ?? ""
      if (!botId || !BOT_COMMAND_ACTIONS.has(action)) {
        return { type: "unknown", originalType: type, payload: record }
      }
      return {
        type: "bot_command",
        bot_id: botId,
        action: action as BotCommandAction,
        config: mergeConfig(botId, record.config),
        timestamp: asString(record.timestamp),
        vm_host: asString(record.vm_host),
      }
    }
    case "config_upload": {
      const botId = asString(record.bot_id) ?? ""
      const action = asString(record.action) ?? "update"
      const config = mergeConfig(botId, record.config)
      if (!botId || !config || !CONFIG_UPLOAD_ACTIONS.has(action)) {
        return { type: "unknown", originalType: type, payload: record }
      }
      return {
        type: "config_upload",
        bot_id: botId,
        config,
        action: action as ConfigUploadAction,
        vm_host: asString(record.vm_host),
      }
    }
    case "bot_logs_request": {
      const botId = asString(record.bot_id) ?? ""
      const requestId = asString(record.request_id) ?? ""
      if (!botId || !requestId) {
        return { type: "unknown", originalType: type, payload: record }
      }
      const lines = typeof record.lines === "number" ? record.lines : Number(record.lines)
      return {
        type: "bot_logs_request",
        bot_id: botId,
        request_id: requestId,
        lines: Number.isFinite(lines) ? lines : undefined,
        vm_host: asString(record.vm_host),
      }
    }
    default:
      return { type: "unknown", originalType: type, payload: record }
  }
}

export function extractHostedBots(payload: unknown): HostedBotInfo[] {
  const items: unknown[] = []
  if (Array.isArray(payload)) items.push(...payload)
  else {
    const record = asRecord(payload)
    if (!record) return []
    const nested = record.bots ?? record.data ?? record.items ?? record.results
    if (Array.isArray(nested)) items.push(...nested)
    else {
      const nestedRecord = asRecord(nested)
      const nestedList = nestedRecord?.bots ?? nestedRecord?.items
      if (Array.isArray(nestedList)) items.push(...nestedList)
      else if (typeof record.bot_id === "string") items.push(record)
    }
  }

  const out: HostedBotInfo[] = []
  for (const item of items) {
    const record = asRecord(item)
    if (!record) continue
    const botId = asString(record.bot_id) ?? asString(record.botId) ?? asString(record.id)
    if (!botId) continue
    const vmHost = asString(record.vm_host) ?? asString(record.vmHost)
    const status = asString(record.status)
    const config = mergeConfig(botId, record.config ?? record)
    out.push({ bot_id: botId, vm_host: vmHost, status, config })
  }
  return out
}

export function extractBotRecord(payload: unknown, botId: string): HostedBotInfo | null {
  const record = asRecord(payload)
  if (!record) return null
  const nested = asRecord(record.bot) ?? asRecord(record.data) ?? record
  const id = asString(nested.bot_id) ?? asString(nested.botId) ?? botId
  const config = mergeConfig(id, nested.config ?? nested)
  return {
    bot_id: id,
    vm_host: asString(nested.vm_host) ?? asString(nested.vmHost),
    status: asString(nested.status),
    config,
  }
}
