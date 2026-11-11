import { spawn } from "node:child_process"
import { existsSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { HostContext } from "./context.js"

export const VM_UPDATE_LOCK = "/tmp/vm-update.lock"
const UPDATE_SCRIPT = "scripts/vm-self-update.sh"
/** Une mise à jour ne dure jamais aussi longtemps : au-delà, le verrou est considéré comme orphelin (script tué). */
const STALE_LOCK_MS = 30 * 60_000

function clearStaleLock(ctx: HostContext): void {
  try {
    const age = Date.now() - statSync(VM_UPDATE_LOCK).mtimeMs
    if (age > STALE_LOCK_MS) {
      ctx.log.warn(`Removing stale ${VM_UPDATE_LOCK} (${Math.round(age / 60_000)} min old)`)
      unlinkSync(VM_UPDATE_LOCK)
    }
  } catch {
    /* verrou absent ou déjà supprimé */
  }
}

export function tryStartVmUpdate(ctx: HostContext, requestId: string): void {
  clearStaleLock(ctx)
  if (existsSync(VM_UPDATE_LOCK)) {
    ctx.log.warn(`vm_command update ignored: lock present (${VM_UPDATE_LOCK})`)
    ctx.ws.send({
      type: "vm_update_status",
      request_id: requestId,
      status: "rejected",
      step: "locked",
      vm_host: ctx.env.vmHost,
    })
    return
  }

  try {
    writeFileSync(VM_UPDATE_LOCK, `${process.pid}\n${new Date().toISOString()}\n`, { flag: "wx" })
  } catch {
    ctx.log.warn(`vm_command update ignored: failed to acquire ${VM_UPDATE_LOCK}`)
    ctx.ws.send({
      type: "vm_update_status",
      request_id: requestId,
      status: "rejected",
      step: "locked",
      vm_host: ctx.env.vmHost,
    })
    return
  }

  ctx.ws.send({
    type: "vm_update_status",
    request_id: requestId,
    status: "running",
    step: "started",
    vm_host: ctx.env.vmHost,
  })

  const scriptPath = join(ctx.env.repoRoot, UPDATE_SCRIPT)
  const spawnOpts = {
    detached: true,
    stdio: "ignore" as const,
    cwd: ctx.env.repoRoot,
  }

  const onSpawnError = (error: Error): void => {
    ctx.log.error(`VM self-update spawn failed: ${error.message}`)
    try {
      unlinkSync(VM_UPDATE_LOCK)
    } catch {
      /* ignore */
    }
  }

  // setsid when available — script also re-execs under its own session as fallback
  const child = spawn("setsid", ["bash", scriptPath], spawnOpts)
  child.on("error", () => {
    const fallback = spawn("bash", [scriptPath], spawnOpts)
    fallback.on("error", onSpawnError)
    fallback.unref()
  })
  child.unref()

  ctx.log.info(`VM self-update started request_id=${requestId}`)
}
