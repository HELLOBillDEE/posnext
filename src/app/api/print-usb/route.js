import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export const runtime = 'nodejs'

// ── Persistent PowerShell worker ─────────────────────────────────────────
// Spawns once → stays alive → no per-request PS startup overhead
// ใช้ Add-Type แบบ in-memory (ไม่ OutputAssembly) เพื่อไม่เรียก csc.exe แยก
// → ไม่มีหน้าต่าง PowerShell เด้งขึ้นมา

let _w = null   // { proc, queue:[], buf:'', ready:false }

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class WP6 {
  [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
  public static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);
  [DllImport("winspool.drv",SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
  public static extern int StartDocPrinter(IntPtr h,int lv,ref DOCINFOW di);
  [DllImport("winspool.drv")] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv")] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv")] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv")] public static extern bool WritePrinter(IntPtr h,byte[] b,int n,out int w);
}
[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
public struct DOCINFOW { public string pDocName; public string pOutputFile; public string pDataType; }
'@
$handles=@{}
function GetHandle([string]$pov) {
  if ($handles[$pov]) { return $handles[$pov] }
  $pn=$pov
  if ($pov -match '^USB\d+$') {
    $f=Get-WmiObject Win32_Printer|Where-Object{$_.PortName -eq $pov}|Select-Object -First 1
    if(-not $f){return $null}; $pn=$f.Name
  }
  $h=[IntPtr]::Zero
  if(-not [WP6]::OpenPrinter($pn,[ref]$h,[IntPtr]::Zero)){return $null}
  $handles[$pov]=$h; return $h
}
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
while($true){
  $line=[Console]::In.ReadLine()
  if($null -eq $line){break}
  $line=$line.Trim(); if($line -eq ''){continue}
  try{
    $p=$line -split '\|',3
    if($p[0] -eq 'WARMUP'){
      GetHandle $p[1]|Out-Null
      [Console]::Out.WriteLine('OK:warmup'); [Console]::Out.Flush(); continue
    }
    $h=GetHandle $p[1]
    if($null -eq $h){[Console]::Out.WriteLine('ERR:no printer'); [Console]::Out.Flush(); continue}
    $b=[Convert]::FromBase64String($p[2])
    $di=New-Object DOCINFOW; $di.pDocName='POS'; $di.pDataType='RAW'
    $j=[WP6]::StartDocPrinter($h,1,[ref]$di)
    if($j -le 0){[Console]::Out.WriteLine('ERR:StartDoc'); [Console]::Out.Flush(); continue}
    [WP6]::StartPagePrinter($h)|Out-Null
    $w=0; [WP6]::WritePrinter($h,$b,$b.Length,[ref]$w)|Out-Null
    [WP6]::EndPagePrinter($h)|Out-Null; [WP6]::EndDocPrinter($h)|Out-Null
    [Console]::Out.WriteLine("OK:$w"); [Console]::Out.Flush()
  } catch { [Console]::Out.WriteLine("ERR:$($_.Exception.Message)"); [Console]::Out.Flush() }
}
`

function startWorker() {
  const ps1 = join(tmpdir(), 'pos_print_worker6.ps1')
  writeFileSync(ps1, Buffer.concat([Buffer.from([0xFF,0xFE]), Buffer.from(SCRIPT,'utf16le')]))

  const proc = spawn('powershell', [
    '-WindowStyle','Hidden','-NonInteractive','-ExecutionPolicy','Bypass','-File',ps1,
  ], { windowsHide: true })

  const w = { proc, queue:[], buf:'', ready:false }

  proc.stdout.on('data', chunk => {
    w.buf += chunk.toString()
    const lines = w.buf.split('\n')
    w.buf = lines.pop()
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      if (!w.ready && line === 'READY') { w.ready = true; continue }
      if (w.queue.length > 0) {
        const { resolve } = w.queue.shift()
        resolve(line)
      }
    }
  })
  proc.stderr.on('data', d => console.error('[ps-worker]', d.toString().slice(0,200)))
  proc.on('exit', () => { if (_w === w) _w = null })
  return w
}

function getWorker() {
  if (_w && !_w.proc.killed) return _w
  _w = startWorker()
  return _w
}

async function waitReady(w, timeoutMs = 20000) {
  if (w.ready) return
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('worker timeout')), timeoutMs)
    const iv = setInterval(() => {
      if (w.ready)       { clearInterval(iv); clearTimeout(t); resolve() }
      if (w.proc.killed) { clearInterval(iv); clearTimeout(t); reject(new Error('worker died')) }
    }, 30)
  })
}

async function workerCmd(cmd) {
  const w = getWorker()
  await waitReady(w)
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('print timeout')), 30000)
    w.queue.push({ resolve: r => { clearTimeout(t); resolve(r) }, reject })
    w.proc.stdin.write(cmd + '\n')
  })
}

// Pre-start worker when module loads (PM2 boot)
if (process.platform === 'win32') getWorker()

// ── Handlers ──────────────────────────────────────────────────────────────

// GET /api/print-usb?port=USB001  — warmup (called by POS page on mount)
export async function GET(req) {
  const port = new URL(req.url).searchParams.get('port') || 'USB001'
  try {
    const result = await workerCmd(`WARMUP|${port}`)
    return Response.json({ ok: true, result })
  } catch (e) {
    return Response.json({ ok: false, error: e.message })
  }
}

export async function POST(req) {
  try {
    const { data, usb_port } = await req.json()
    if (!data) return Response.json({ error: 'ไม่มีข้อมูล' }, { status: 400 })

    const port = (usb_port || 'USB001').trim()
    // Fire-and-forget: ส่งคำสั่งให้ PS worker แล้ว return ทันที ไม่รอ
    // ลิ้นชักและเครื่องพิมพ์จะทำงานใน background — UI ตอบสนองทันที
    workerCmd(`PRINT|${port}|${data}`).catch(e => {
      // worker died — restart and retry once (silent)
      if (_w) { try { _w.proc.kill() } catch {} _w = null }
      workerCmd(`PRINT|${port}|${data}`).catch(e2 => console.error('[usb print]', e2.message))
    })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
