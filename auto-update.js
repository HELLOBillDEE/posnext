const { execSync } = require('child_process')

const CWD = __dirname
const INTERVAL = 5 * 60 * 1000 // 5 นาที

function run(cmd) {
  return execSync(cmd, { cwd: CWD, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

function log(msg) {
  const t = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  console.log(`[${t}] ${msg}`)
}

async function check() {
  try {
    run('git fetch origin main')
    const local  = run('git rev-parse HEAD')
    const remote = run('git rev-parse origin/main')
    if (local === remote) { log('ไม่มีอัพเดท'); return }
    log('พบ commit ใหม่ — กำลัง pull + build...')
    run('git pull')
    run('npm run build')
    run('pm2 restart posnext')
    log('✓ อัพเดทเสร็จ — posnext restarted')
  } catch (e) {
    log('Error: ' + (e.stderr || e.message || '').toString().slice(0, 200))
  }
}

log(`Auto-update เริ่มทำงาน (ตรวจทุก ${INTERVAL / 60000} นาที)`)
check()
setInterval(check, INTERVAL)
