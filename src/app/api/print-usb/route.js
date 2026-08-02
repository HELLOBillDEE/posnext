import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export const runtime = 'nodejs'

function buildPsScript(portOrName, filePath) {
  const fp = filePath.replace(/\\/g, '\\\\')
  const pov = portOrName.replace(/"/g, '""')
  return `
$ErrorActionPreference = "Stop"
try {
  # ถ้าเป็น USB port (เช่น USB004) ให้ค้นหาชื่อเครื่องพิมพ์จาก WMI
  $pov = "${pov}"
  if ($pov -match '^USB\\d+$') {
    $found = Get-WmiObject Win32_Printer | Where-Object { $_.PortName -eq $pov } | Select-Object -First 1
    if (-not $found) { Write-Output "ERR:No printer found on port $pov"; exit 1 }
    $pn = $found.Name
  } else {
    $pn = $pov
  }

  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinPrint3 {
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern int StartDocPrinter(IntPtr h, int lv, ref DOCINFOW di);
    [DllImport("winspool.drv")]
    public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.drv")]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.drv")]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.drv")]
    public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
}
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct DOCINFOW {
    public string pDocName;
    public string pOutputFile;
    public string pDataType;
}
"@
  $bytes = [System.IO.File]::ReadAllBytes("${fp}")
  $h = [IntPtr]::Zero
  if (-not [WinPrint3]::OpenPrinter($pn, [ref]$h, [IntPtr]::Zero)) {
    $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Output "ERR:OpenPrinter failed [$pn] win32=$code"
    exit 1
  }
  $di = New-Object DOCINFOW
  $di.pDocName = "POS"
  $di.pDataType = "RAW"
  $job = [WinPrint3]::StartDocPrinter($h, 1, [ref]$di)
  if ($job -le 0) { [WinPrint3]::ClosePrinter($h); Write-Output "ERR:StartDocPrinter failed"; exit 1 }
  [WinPrint3]::StartPagePrinter($h) | Out-Null
  $w = 0
  [WinPrint3]::WritePrinter($h, $bytes, $bytes.Length, [ref]$w) | Out-Null
  [WinPrint3]::EndPagePrinter($h) | Out-Null
  [WinPrint3]::EndDocPrinter($h) | Out-Null
  [WinPrint3]::ClosePrinter($h) | Out-Null
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
    const ts = Date.now()
    const tmp = join(tmpdir(), `pos_print_${ts}.bin`)
    const ps1 = join(tmpdir(), `pos_print_${ts}.ps1`)
    await fs.writeFile(tmp, bytes)

    const portOrName = (usb_port || 'USB001').trim()
    // เขียนด้วย UTF-16LE + BOM เพื่อให้ PowerShell 5.x อ่านได้ถูก encoding
    const scriptContent = buildPsScript(portOrName, tmp)
    const buf = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(scriptContent, 'utf16le')])
    await fs.writeFile(ps1, buf)

    const stdout = await new Promise((resolve, reject) => {
      execFile('powershell', [
        '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', ps1,
      ], (err, out) => {
        fs.unlink(ps1).catch(() => {})
        fs.unlink(tmp).catch(() => {})
        resolve((out || '').trim())
      })
    })

    if (stdout.startsWith('ERR:')) return Response.json({ error: stdout.slice(4) }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
