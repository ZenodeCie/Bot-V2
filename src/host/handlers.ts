import { isValidBotId } from "../shared/botId.js"
import type { BotConfig } from "../shared/botConfig.js"
import { reportBotStatus, type HostContext } from "./context.js"
import type {
  BotCommandMessage,
  BotLogsRequestMessage,
  ConfigUploadMessage,
  InboundMessage,
} from "./protocol.js"

class BotLocks {
  private readonly locks = new Map<string, Promise<void>>()

  run(botId: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.locks.get(botId) ?? Promise.resolve()
    const next = previous.then(fn, fn)
    this.locks.set(
      botId,
      next.then(
        () => undefined,
        () => undefined
      )
    )
    return next
  }
}

export class MessageRouter {
  private readonly locks = new BotLocks()

  constructor(private readonly ctx: HostContext) {}

  async handle(message: InboundMessage): Promise<void> {
    switch (message.type) {
      case "welcome":
        this.ctx.log.info(`Core welcome: ${message.message}${message.vm_type ? ` vm_type=${message.vm_type}` : ""}`)
        return
      case "pong":
        return
      case "ping":
        this.ctx.ws.send({ type: "pong", timestamp: new Date().toISOString(), vm_host: this.ctx.env.vmHost })
        return
      case "error":
        this.ctx.log.warn(`Core error: ${message.message ?? message.error ?? "unknown"}`)
        return
      case "config_upload":
        await this.locks.run(message.bot_id, () => this.onConfigUpload(message))
        return
      case "bot_command":
        await this.locks.run(message.bot_id, () => this.onBotCommand(message))
        return
      case "bot_logs_request":
        await this.onLogsRequest(message)
        return
      case "unknown":
        this.ctx.log.warn(`Ignoring unknown WS type "${message.originalType}"`)
        return
    }
  }

  private async onConfigUpload(message: ConfigUploadMessage): Promise<void> {
    if (!isValidBotId(message.bot_id)) {
      this.ctx.log.error(`config_upload rejected: invalid bot_id ${message.bot_id}`)
      this.ctx.ws.send({
        type: "config_received",
        bot_id: message.bot_id,
        status: "error",
        message: "bot_id invalide",
        vm_host: this.ctx.env.vmHost,
      })
      return
    }
    try {
      await this.ctx.store.write(message.bot_id, { ...message.config, bot_id: message.bot_id })
      this.ctx.log.info(`Config ${message.action} saved for ${message.bot_id}`)
      this.ctx.ws.send({
        type: "config_received",
        bot_id: message.bot_id,
        status: "success",
        message: "Config enregistrée",
        vm_host: this.ctx.env.vmHost,
      })
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      this.ctx.log.error(`config_upload ${message.bot_id} failed: ${text}`)
      this.ctx.ws.send({
        type: "config_received",
        bot_id: message.bot_id,
        status: "error",
        message: text,
        vm_host: this.ctx.env.vmHost,
      })
    }
  }

  private async onBotCommand(message: BotCommandMessage): Promise<void> {
    if (!isValidBotId(message.bot_id)) {
      this.ctx.log.error(`bot_command rejected: invalid bot_id ${message.bot_id}`)
      await reportBotStatus(this.ctx, message.bot_id, "error")
      return
    }
    try {
      switch (message.action) {
        case "start":
          await this.startBot(message.bot_id, message.config)
          return
        case "stop":
          await this.ctx.pm2.stop(message.bot_id)
          this.ctx.log.info(`Stopped ${message.bot_id}`)
          await reportBotStatus(this.ctx, message.bot_id, "offline")
          return
        case "restart":
          await this.restartBot(message.bot_id, message.config)
          return
        case "delete":
          await this.ctx.pm2.delete(message.bot_id)
          await this.ctx.store.remove(message.bot_id)
          this.ctx.log.info(`Deleted ${message.bot_id} process + config`)
          await reportBotStatus(this.ctx, message.bot_id, "offline")
          return
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      this.ctx.log.error(`bot_command ${message.action} ${message.bot_id} failed: ${text}`)
      await reportBotStatus(this.ctx, message.bot_id, "error")
    }
  }

  private async startBot(botId: string, incoming: BotConfig | undefined): Promise<void> {
    if (incoming) await this.ctx.store.write(botId, { ...incoming, bot_id: botId })

    const hosted = await this.ctx.rest.isHostedElsewhere(botId)
    if (hosted.elsewhere) {
      this.ctx.log.warn(`Refusing start ${botId}: already online on ${hosted.vmHost}`)
      await reportBotStatus(this.ctx, botId, "offline")
      return
    }

    const local = await this.ensureLocalConfig(botId, incoming)
    if (!local?.token) {
      this.ctx.log.error(`Cannot start ${botId}: missing token in config`)
      await reportBotStatus(this.ctx, botId, "error")
      return
    }

    const existing = await this.ctx.pm2.describe(botId)
    if (existing?.status === "online" || existing?.status === "starting") {
      this.ctx.log.info(`start ${botId}: already ${existing.status}`)
      await reportBotStatus(this.ctx, botId, existing.status)
      return
    }

    await reportBotStatus(this.ctx, botId, "starting")
    await this.ctx.pm2.start(botId, this.ctx.store.pathFor(botId), local)
    await reportBotStatus(this.ctx, botId, "online")
    this.ctx.log.info(`Started ${botId}`)
  }

  private async restartBot(botId: string, incoming: BotConfig | undefined): Promise<void> {
    if (incoming) await this.ctx.store.write(botId, { ...incoming, bot_id: botId })
    const local = await this.ensureLocalConfig(botId, incoming)
    if (!local?.token) {
      this.ctx.log.error(`Cannot restart ${botId}: missing token in config`)
      await reportBotStatus(this.ctx, botId, "error")
      return
    }
    await reportBotStatus(this.ctx, botId, "starting")
    await this.ctx.pm2.restart(botId, this.ctx.store.pathFor(botId), local)
    await reportBotStatus(this.ctx, botId, "online")
    this.ctx.log.info(`Restarted ${botId}`)
  }

  private async ensureLocalConfig(botId: string, incoming: BotConfig | undefined): Promise<BotConfig | null> {
    if (incoming) return this.ctx.store.read(botId)
    const existing = await this.ctx.store.read(botId)
    if (existing?.token) return existing
    try {
      const remote = await this.ctx.rest.getBot(botId)
      if (remote?.config) {
        await this.ctx.store.write(botId, { ...remote.config, bot_id: botId })
        return this.ctx.store.read(botId)
      }
    } catch (error) {
      this.ctx.log.warn(`GET /bots/${botId} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return existing
  }

  private async onLogsRequest(message: BotLogsRequestMessage): Promise<void> {
    const lines = Math.min(500, Math.max(1, Math.floor(message.lines ?? 100)))
    if (!isValidBotId(message.bot_id)) {
      this.ctx.ws.send({
        type: "bot_logs_response",
        request_id: message.request_id,
        bot_id: message.bot_id,
        stdout: "",
        stderr: "",
        error: "invalid bot_id",
      })
      return
    }
    try {
      const logs = await this.ctx.pm2.logs(message.bot_id, lines)
      this.ctx.ws.send({
        type: "bot_logs_response",
        request_id: message.request_id,
        bot_id: message.bot_id,
        stdout: logs.stdout,
        stderr: logs.stderr,
        error: logs.error,
      })
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      this.ctx.log.warn(`logs_request ${message.bot_id} failed: ${text}`)
      this.ctx.ws.send({
        type: "bot_logs_response",
        request_id: message.request_id,
        bot_id: message.bot_id,
        stdout: "",
        stderr: "",
        error: text,
      })
    }
  }
}
