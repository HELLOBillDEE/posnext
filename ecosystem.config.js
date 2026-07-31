module.exports = {
  apps: [{
    name: 'posnext',
    script: 'node_modules/next/dist/bin/next',
    args: 'start',
    interpreter: 'node',
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    kill_timeout: 5000,
    wait_ready: false,
    env: { NODE_ENV: 'production', PORT: 3000 },
  }]
}
