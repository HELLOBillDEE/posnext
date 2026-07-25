const { createServer: createHttps } = require('https')
const { createServer: createHttp }  = require('http')
const { readFileSync } = require('fs')
const { join }   = require('path')
const { parse }  = require('url')
const next = require('next')

const app    = next({ dev: false })
const handle = app.getRequestHandler()

const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '3443', 10)
const HTTP_PORT  = parseInt(process.env.PORT       || '3000', 10)

const certDir  = join(process.cwd(), 'certificates')
const tlsOpts  = {
  key:  readFileSync(join(certDir, 'localhost-key.pem')),
  cert: readFileSync(join(certDir, 'localhost.pem')),
}

app.prepare().then(() => {
  // HTTPS — กล้อง / getUserMedia ต้องการ secure context
  createHttps(tlsOpts, (req, res) => {
    handle(req, res, parse(req.url, true))
  }).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`> Ready on https://0.0.0.0:${HTTPS_PORT}`)
  })

  // HTTP — serve content ตรงๆ สำหรับ Customer Display (ไม่ต้องการ secure context)
  createHttp((req, res) => {
    handle(req, res, parse(req.url, true))
  }).listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`> HTTP on http://0.0.0.0:${HTTP_PORT} (Customer Display)`)
  })
})
