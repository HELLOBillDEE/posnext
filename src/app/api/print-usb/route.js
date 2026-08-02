import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export const runtime = 'nodejs'

// ใช้ try/catch + Write-Output เพื่อให้ error ออกมาเป็น plain text ไม่ใช่ CLIXML
const PS_PRINT = `
try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinPrint {
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
  $pn = $env:PRINTER_NAME
  $fp = $env:FILE_PATH
  $bytes = [System.IO.File]::ReadAllBytes($fp)
  $h = [IntPtr]::Zero
  if (-not [WinPrint]::OpenPrinter($pn, [ref]$h, [IntPtr]::Zero)) {
    $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Output "ERROR:Cannot open printer '$pn' (Win32 $code)"
    exit 1
  }
  $di = New-Object DOCINFOA
  $di.pDocName = "POS"
  $di.pDataType = "RAW"
  $job = [WinPrint]::StartDocPrinter($h, 1, [ref]$di)
  if ($job -le 0) { [WinPrint]::ClosePrinter($h); Write-Output "ERROR:StartDocPrinter failed"; exit 1 }
  [WinPrint]::StartPagePrinter($h) | Out-Null
  $w = 0
  [WinPrint]::WritePrinter($h, $bytes, $bytes.Length, [ref]$w) | Out-Null
  [WinPrint]::EndPagePrinter($h) | Out-Null
  [WinPrint]::EndDocPrinter($h) | Out-Null
  [WinPrint]::ClosePrinter($h) | Out-Null
  Write-Output "OK"
} catch {
  Write-Output "ERROR:$($_.Exception.Message)"
  exit 1
}
`

export async function POST(req) {
  try {
    const { data, usb_port } = await req.json()
    if (!data) return Response.json({ error: 'ไม่มีข้อมูล' }, { status: 400 })

    const bytes = Buffer.from(data, 'base64')
    const tmp = join(tmpdir(), `pos_print_${Date.now()}.bin`)
    await fs.writeFile(tmp, bytes)

    const printerName = (usb_port || 'Receipt Printer').trim()
    const encoded = Buffer.from(PS_PRINT, 'utf16le').toString('base64')

    const output = await new Promise((resolve, reject) => {
      execFile('powershell', [
        '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encoded,
      ], {
        env: { ...process.env, PRINTER_NAME: printerName, FILE_PATH: tmp },
      }, (err, stdout) => {
        fs.unlink(tmp).catch(() => {})
        resolve({ err, stdout: (stdout || '').trim() })
      })
    })

    const { err, stdout } = output
    if (stdout.startsWith('ERROR:')) return Response.json({ error: stdout.slice(6) }, { status: 500 })
    if (err) return Response.json({ error: err.message }, { status: 500 })
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
