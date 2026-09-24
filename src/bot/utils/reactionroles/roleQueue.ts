/**
 * File de mutations de rôles par guild : sérialise les opérations Discord
 * pour éviter les 429 quand un panel distribue beaucoup de rôles d'un coup.
 */

const ROLE_OP_GAP_MS = 250

const queues = new Map<string, Promise<void>>()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function enqueueRoleOp(guildId: string, op: () => Promise<void>): Promise<void> {
  const previous = queues.get(guildId) ?? Promise.resolve()
  const task = previous.then(
    async () => {
      await op()
      await delay(ROLE_OP_GAP_MS)
    },
    async () => {
      await op()
      await delay(ROLE_OP_GAP_MS)
    }
  )
  const slot = task.catch(() => undefined)
  queues.set(guildId, slot)
  void slot.finally(() => {
    if (queues.get(guildId) === slot) queues.delete(guildId)
  })
  return task
}