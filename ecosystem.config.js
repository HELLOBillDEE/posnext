module.exports = {
  apps: [{
    name: 'posnext',
    cwd: '/Users/kanitthaphoothong/Desktop/POSNEXT/posnext',
    script: './node_modules/.bin/next',
    args: 'start',
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    kill_timeout: 5000,
    wait_ready: false,
    env: { NODE_ENV: 'production', PORT: 3000 },
  }]
}
