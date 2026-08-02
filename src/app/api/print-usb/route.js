import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export const runtime = 'nodejs'

function buildPsScript(printerName, filePath) {
  // ใช้ double-quote escaping สำหรับชื่อเครื่องพิมพ์ใน PS string
  const pn = printerName.replace(/"/g, '""')
  const fp = filePath.replace(/\\/g, '\\\\')
  return `
try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinPrint2 {
    [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
    public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
    public static extern int StartDocPrinter(IntPtr h, int lv, ref DOCINFOA di);
    [DllImport("winspool.drv")]
    public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.drv")]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.drv")]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.drv")]
    public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
}
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
public struct DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
}
"@
  $bytes = [System.IO.File]::ReadAllBytes("${fp}")
  $h = [IntPtr]::Zero
  if (-not [WinPrint2]::OpenPrinter("${pn}", [ref]$h, [IntPtr]::Zero)) {
    $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Output "ERR:Cannot open printer [${pn}] win32=$code"
    exit 1
  }
  $di = New-Object DOCINFOA
  $di.pDocName = "POS"
  $di.pDataType = "RAW"
  $job = [WinPrint2]::StartDocPrinter($h, 1, [ref]$di)
  if ($job -le 0) { [WinPrint2]::ClosePrinter($h); Write-Output "ERR:StartDocPrinter failed"; exit 1 }
  [WinPrint2]::StartPagePrinter($h) | Out-Null
  $w = 0
  [WinPrint2]::WritePrinter($h, $bytes, $bytes.Length, [ref]$w) | Out-Null
  [WinPrint2]::EndPagePrinter($h) | Out-Null
  [WinPrint2]::EndDocPrinter($h) | Out-Null
  [WinPrint2]::ClosePrinter($h) | Out-Null
  Write-Output "OK"
} catch {
  Write-Output "ERR:$($_.Exception.Message)"
  exit 1
}
`
}

export async function POST(req) {
  try {
    const { data, usb_port } = await req.json()
    if (!data) return Response.json({ error: 'ไม่มีข้อมูล' }, { status: 400 })

    const bytes = Buffer.from(data, 'base64')
    const tmp = join(tmpdir(), `pos_print_${Date.now()}.bin`)
    const ps1 = join(tmpdir(), `pos_print_${Date.now()}.ps1`)
    await fs.writeFile(tmp, bytes)

    const printerName = (usb_port || 'Receipt Printer').trim()
    await fs.writeFile(ps1, buildPsScript(printerName, tmp), 'utf8')

    const stdout = await new Promise((resolve, reject) => {
      execFile('powershell', [
        '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', ps1,
      ], (err, out, stderr) => {
        fs.unlink(ps1).catch(() => {})
        fs.unlink(tmp).catch(() => {})
        if (err && !(out || '').includes('OK')) reject(new Error((out || stderr || err.message).trim()))
        else resolve((out || '').trim())
      })
    })

    if (stdout.startsWith('ERR:')) return Response.json({ error: stdout.slice(4) }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
