import { spawn, spawnSync } from 'child_process'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

// ── USB Printer via pre-compiled EXE ─────────────────────────────────────
// ครั้งแรก: compile C# EXE ด้วย csc.exe ที่มีใน .NET Framework (built-in Windows)
// หลังจากนั้น: spawn EXE โดยตรง ~100ms/request — ไม่มี PS overhead เลย

const EXE_DIR  = 'C:\\Users\\cherd\\posnext\\usbprint'
const EXE_PATH = 'C:\\Users\\cherd\\posnext\\usbprint\\wprint.exe'
const CS_PATH  = 'C:\\Users\\cherd\\posnext\\usbprint\\wprint.cs'

const CS_SOURCE = `
using System;
using System.Management;
using System.Runtime.InteropServices;
class WPrint {
  [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);
  [DllImport("winspool.drv")] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern int StartDocPrinter(IntPtr h,int lv,ref DOC_INFO_1 d);
  [DllImport("winspool.drv")] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv")] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv")] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv")] static extern bool WritePrinter(IntPtr h,byte[] b,int n,out int w);
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
  struct DOC_INFO_1 { public string pDocName,pOutputFile,pDataType; }

  static string ResolvePort(string portOrName) {
    if (!portOrName.ToUpper().StartsWith("USB")) return portOrName;
    try {
      var q = new ManagementObjectSearcher("SELECT Name FROM Win32_Printer WHERE PortName='" + portOrName + "'");
      foreach (ManagementObject o in q.Get()) return o["Name"].ToString();
    } catch {}
    return portOrName;
  }

  static int Main(string[] args) {
    if (args.Length < 2) { Console.Error.WriteLine("Usage: wprint <port> <base64>"); return 1; }
    string name = ResolvePort(args[0]);
    byte[] data = Convert.FromBase64String(args[1]);
    IntPtr h = IntPtr.Zero;
    if (!OpenPrinter(name, out h, IntPtr.Zero)) { Console.Error.WriteLine("ERR:OpenPrinter " + name); return 2; }
    DOC_INFO_1 di = new DOC_INFO_1 { pDocName="POS", pDataType="RAW" };
    if (StartDocPrinter(h,1,ref di) <= 0) { ClosePrinter(h); Console.Error.WriteLine("ERR:StartDoc"); return 3; }
    StartPagePrinter(h);
    int w = 0; WritePrinter(h,data,data.Length,out w);
    EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h);
    Console.WriteLine("OK:" + w);
    return 0;
  }
}
`

// csc.exe locations in .NET Framework (built-in Windows)
const CSC_PATHS = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
]

let _exeReady = null  // null=unknown, true=ready, false=unavailable

function findCsc() {
  for (const p of CSC_PATHS) if (existsSync(p)) return p
  return null
}

function ensureExe() {
  if (process.platform !== 'win32') return false
  if (existsSync(EXE_PATH)) { _exeReady = true; return true }

  const csc = findCsc()
  if (!csc) { console.error('[wprint] csc.exe not found'); _exeReady = false; return false }

  try {
    if (!existsSync(EXE_DIR)) mkdirSync(EXE_DIR, { recursive: true })
    writeFileSync(CS_PATH, CS_SOURCE, 'utf8')
    const r = spawnSync(csc, [
      `/out:${EXE_PATH}`, '/optimize+', '/nologo',
      '/reference:System.Management.dll', CS_PATH,
    ], { windowsHide: true, timeout: 30000 })
    if (r.status === 0 && existsSync(EXE_PATH)) {
      _exeReady = true
      console.log('[wprint] EXE compiled OK')
      return true
    }
    console.error('[wprint] compile failed:', r.stderr?.toString().slice(0, 200))
    _exeReady = false
    return false
  } catch (e) {
    console.error('[wprint] compile error:', e.message)
    _exeReady = false
    return false
  }
}

function printViaExe(port, b64) {
  return new Promise((resolve, reject) => {
    const proc = spawn(EXE_PATH, [port, b64], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { out += d })
    proc.on('close', code => {
      if (out.startsWith('OK:')) resolve(out.trim())
      else reject(new Error(out.trim() || `exit ${code}`))
    })
    proc.on('error', reject)
    setTimeout(() => { proc.kill(); reject(new Error('timeout')) }, 10000)
  })
}

// ── Pre-compile EXE at server start ──────────────────────────────────────
if (process.platform === 'win32') {
  // Run in background — does not block startup
  Promise.resolve().then(() => ensureExe())
}

// ── Handlers ──────────────────────────────────────────────────────────────

// GET /api/print-usb?port=USB001 — warmup: ensure EXE exists + test port
export async function GET(req) {
  const port = new URL(req.url).searchParams.get('port') || 'USB001'
  if (process.platform !== 'win32') return Response.json({ ok: true, note: 'non-windows' })

  if (!_exeReady) ensureExe()
  if (!_exeReady) return Response.json({ ok: false, error: 'csc not found' })

  // Warmup: do a dry-run open/close of the printer handle
  // We send empty data — printer ignores it
  try {
    await printViaExe(port, btoa(''))
  } catch {}  // ok to fail on empty doc
  return Response.json({ ok: true })
}

export async function POST(req) {
  try {
    const { data, usb_port } = await req.json()
    if (!data) return Response.json({ error: 'ไม่มีข้อมูล' }, { status: 400 })

    const port = (usb_port || 'USB001').trim()

    if (process.platform !== 'win32') {
      return Response.json({ error: 'USB print only on Windows' }, { status: 400 })
    }

    if (!_exeReady) ensureExe()
    if (!_exeReady) return Response.json({ error: 'wprint.exe ยังไม่พร้อม' }, { status: 503 })

    // Fire-and-forget: ส่งให้ EXE พิมพ์ แล้ว return ทันที
    printViaExe(port, data).catch(e => console.error('[wprint]', e.message))
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
