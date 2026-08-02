import "dotenv/config"

const token = process.env.BOT_TOKEN
const mongodbUri = process.env.MONGODB_URI

if (!token) {
  console.error("BOT_TOKEN missing from environment variables.")
  process.exit(1)
}

if (!mongodbUri) {
  console.error("MONGODB_URI missing from environment variables.")
  process.exit(1)
}

export default {
  token,
  mongodbUri,
  prefix: ".",
}

export const colors: Record<string, `#${string}` | null> = {
  red: "#E82C20",
  yel: "#F4E00B",
  orng: "#F47C0B",
  prime: null,
};
