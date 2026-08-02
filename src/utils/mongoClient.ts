import mongoose from "mongoose"
import config from "../config.js"

export default mongoose.connection

export async function connectMongo() {
  await mongoose.connect(config.mongodbUri)
}
