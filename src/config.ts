import "dotenv/config"

const token = process.env.BOT_TOKEN
if (!token) {
  console.error("BOT_TOKEN missing from environment variables.")
  process.exit(1)
}

export default {
  token,
  prefix: ".",
}

export const colors: Record<string, `#${string}` | null> = {
  red: "#E82C20",
  yel: "#F4E00B",
  orng: "#F47C0B",
  prime: null,
};
