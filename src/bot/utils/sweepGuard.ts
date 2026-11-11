export function guardedSweep(label: string, sweep: () => Promise<void>): () => void {
  let running = false
  return () => {
    if (running) return
    running = true
    void sweep()
      .catch((error: unknown) => console.error(`${label} sweep failed:`, error))
      .finally(() => {
        running = false
      })
  }
}
