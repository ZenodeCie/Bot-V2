import { spawn } from "node:child_process"
import { existsSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { HostContext } from "./context.js"

export const VM_UPDATE_LOCK = "/tmp/vm-update.lock"
const UPDATE_SCRIPT = "scripts/vm-self-update.sh"

export function tryStartVmUpdate(ctx: HostContext, requestId: string): void {
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
