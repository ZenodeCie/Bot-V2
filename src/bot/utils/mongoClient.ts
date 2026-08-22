import mongoose from "mongoose"
import config from "../config.js"

export default mongoose.connection

export function mongoDbName(): string {
  const raw = (process.env.MONGODB_DB ?? "znd").trim()
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
  return cleaned || "znd"
}

export async function connectMongo(): Promise<boolean> {
  if (!config.mongodbUri) return false
  await mongoose.connect(config.mongodbUri, { dbName: mongoDbName() })
  return true
}
