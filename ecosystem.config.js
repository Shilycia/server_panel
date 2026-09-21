module.exports = {
  apps: [
    {
      name: "server-panel",
      script: "./server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 8080
      }
    },
    {
      name: "portfolio-web",
      script: "npm",
      args: "start",
      cwd: "../prototype_porto/portfolio-web",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    }
  ]
};
