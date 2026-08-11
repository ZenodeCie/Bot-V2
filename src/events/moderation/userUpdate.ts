import type { Client, User } from "discord.js"
import { recordUsername } from "../../utils/usernameHistory.js"

export default {
  name: "userUpdate",
  async execute(_client: Client, oldUser: User, newUser: User) {
    try {
      if (oldUser.username && newUser.username && oldUser.username !== newUser.username) {
        await recordUsername("global", newUser.id, oldUser.username, "username")
      }
      if (oldUser.globalName && newUser.globalName && oldUser.globalName !== newUser.globalName) {
        await recordUsername("global", newUser.id, oldUser.globalName, "global_name")
      }
    } catch (error) {
      console.error("Failed to record username change:", error)
    }
  },
}