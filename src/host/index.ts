import { config as loadDotenv } from "dotenv"
import { createServer } from "node:http"
import { mkdir } from "node:fs/promises"
import { execFile } from "node:child_process"
import { resolve } from "node:path"
import { promisify } from "node:util"
import { HOST_AGENT_PM2_NAME, loadHostEnv } from "./env.js"
import { toPm2Name } from "../shared/botId.js"
import { createLogger } from "./logger.js"
import { ConfigStore } from "./configStore.js"
import { Pm2Manager } from "./pm2Manager.js"
import { CoreRestClient } from "./restClient.js"
import { CoreWsClient } from "./wsClient.js"
import { MessageRouter } from "./handlers.js"
import { StatusReporter } from "./reporter.js"
import type { HostContext } from "./context.js"

loadDotenv({ path: resolve(process.cwd(), ".env") })
loadDotenv({ path: resolve(process.cwd(), "config.env") })

const execFileAsync = promisify(execFile)

function assertNodeVersion(): void {
  const major = Number(process.versions.node.split(".")[0])
  if (!Number.isFinite(major) || major < 18) {
    throw new Error(`Node.js 18+ required (found ${process.versions.node})`)
  }
}

async function assertPm2(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("pm2", ["-v"], {
      timeout: 8_000,
      encoding: "utf8",
      shell: process.platform === "win32",
    })
    return stdout.trim()
  } catch {
    throw new Error("PM2 is not installed or not in PATH. Install with: npm install -g pm2")
  }
}

async function cleanupOrphans(ctx: HostContext): Promise<void> {
  let assigned: string[] = []
  try {
    assigned = (await ctx.rest.getAssignedBots()).map((bot) => bot.bot_id)
  } catch (error) {
    ctx.log.warn(
      `GET /bots/vm/${ctx.env.vmHost} failed — skip orphan cleanup: ${error instanceof Error ? error.message : String(error)}`
    )
    return
  }
  const assignedSet = new Set(assigned.map((id) => toPm2Name(id)))
  const procs = await ctx.pm2.listBots()
  for (const proc of procs) {
    if (assignedSet.has(proc.name) || assignedSet.has(toPm2Name(proc.name))) {
      ctx.log.info(`Keeping assigned bot process ${proc.name} (${proc.status})`)
      continue
    }
    ctx.log.warn(`Orphan process ${proc.name} not assigned to ${ctx.env.vmHost} — stop/delete`)
    try {
      await ctx.pm2.stop(proc.name)
    } catch (error) {
      ctx.log.error(`Failed to stop orphan ${proc.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function autoStartAssigned(ctx: HostContext): Promise<void> {
  if (!ctx.env.autoStartAssigned) return
  try {
    const assigned = await ctx.rest.getAssignedBots()
    for (const bot of assigned) {
      if (!ctx.store.exists(bot.bot_id)) {
        ctx.log.warn(`AUTO_START skip ${bot.bot_id}: no local config`)
        continue
      }
      const running = await ctx.pm2.describe(bot.bot_id)
      if (running?.status === "online" || running?.status === "starting") continue
      ctx.log.info(`AUTO_START ${bot.bot_id}`)
      const config = await ctx.store.read(bot.bot_id)
      await ctx.pm2.start(bot.bot_id, ctx.store.pathFor(bot.bot_id), config)
    }
  } catch (error) {
    ctx.log.warn(`AUTO_START failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function startLocalHealth(ctx: HostContext, ws: CoreWsClient): void {
  if (!ctx.env.healthPort) return
  const server = createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          ok: true,
          vm_host: ctx.env.vmHost,
          vm_type: ctx.env.vmType,
          ws: ws.connected,
        })
      )
      return
    }
    res.writeHead(404)
    res.end()
  })
  server.listen(ctx.env.healthPort, "127.0.0.1", () => {
    ctx.log.info(`Local health on 127.0.0.1:${ctx.env.healthPort}`)
  })
}

async function main(): Promise<void> {
  assertNodeVersion()
  const env = loadHostEnv()
  const log = createLogger(env.vmHost)
  const pm2Version = await assertPm2()
  log.info(`Boot agent ${HOST_AGENT_PM2_NAME} node=${process.versions.node} pm2=${pm2Version}`)
  log.info(`vmHost=${env.vmHost} vmType=${env.vmType} api=${env.coreApiUrl}`)

  await mkdir(env.configsDir, { recursive: true, mode: 0o700 })
  await mkdir(env.dataDir, { recursive: true })

  const store = new ConfigStore(env)
  await store.ensureDir()
  const pm2 = new Pm2Manager(env, log)
  const rest = new CoreRestClient(env, log)
  const ws = new CoreWsClient(env, log)

  const ctx: HostContext = { env, log, ws, rest, pm2, store }
  const router = new MessageRouter(ctx)
  ws.onMessage((message) => router.handle(message))

  const healthy = await rest.health()
  if (healthy) log.info("Core /health OK")
  else log.warn("Core /health unreachable — WS will keep retrying")

  ws.start()
  await cleanupOrphans(ctx)
  await autoStartAssigned(ctx)

  const reporter = new StatusReporter(ctx)
  reporter.start()
  startLocalHealth(ctx, ws)

  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down agent`)
    reporter.stop()
    ws.stop()
    process.exit(0)
  }
  process.on("SIGINT", () => {
    void shutdown("SIGINT")
  })
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM")
  })
}

main().catch((error: unknown) => {
  console.error("[Host] Fatal:", error)
  process.exit(1)
})
