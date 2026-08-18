export type HostLogger = {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

export function createLogger(vmHost: string): HostLogger {
  const prefix = `[Host][${vmHost}]`
  return {
    info(message, ...args) {
      console.log(prefix, message, ...args)
    },
    warn(message, ...args) {
      console.warn(prefix, message, ...args)
    },
    error(message, ...args) {
      console.error(prefix, message, ...args)
    },
  }
}
