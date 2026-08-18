import mongoose from "mongoose"
import config from "../config.js"

export default mongoose.connection

function mongoDbName(botId: string): string {
  return `znd_${botId.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40)}`
}

export async function connectMongo(): Promise<boolean> {
  if (!config.mongodbUri) return false
  await mongoose.connect(config.mongodbUri, { dbName: mongoDbName(config.botId) })
  return true
}
