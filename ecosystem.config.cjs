/** PM2 ecosystem for the VM host agent only. Bots are spawned at runtime. */
module.exports = {
  apps: [
    {
      name: "zenode-vm-host",
      script: "dist/host/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      kill_timeout: 10_000,
      min_uptime: "5s",
      max_restarts: 15,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
}
