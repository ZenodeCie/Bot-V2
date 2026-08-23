import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export interface AgentVersionInfo {
  version: string
  git_commit: string
  git_branch: string
}

let cachedPackageVersion: string | null = null

function readPackageVersion(repoRoot: string): string {
  if (cachedPackageVersion) return cachedPackageVersion
  try {
    const raw = readFileSync(join(repoRoot, "package.json"), "utf8")
    const pkg = JSON.parse(raw) as { version?: unknown }
    cachedPackageVersion = typeof pkg.version === "string" ? pkg.version : "unknown"
  } catch {
    cachedPackageVersion = "unknown"
  }
  return cachedPackageVersion
}

function gitOutput(repoRoot: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", timeout: 5_000 }).trim()
  } catch {
    return "unknown"
  }
}

export function getAgentVersionInfo(repoRoot: string): AgentVersionInfo {
  return {
    version: readPackageVersion(repoRoot),
    git_commit: gitOutput(repoRoot, ["rev-parse", "--short", "HEAD"]),
    git_branch: gitOutput(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
  }
}
