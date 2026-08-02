param([string]$PrinterName, [string]$FilePath)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinPrint {
    [DllImport("winspool.drv", CharSet=CharSet.Auto)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.drv")]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", CharSet=CharSet.Auto)]
    public static extern int StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOA di);
    [DllImport("winspool.drv")]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv")]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv")]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv")]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
}
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
public struct DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
}
'@
$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$h = [IntPtr]::Zero
if (-not [WinPrint]::OpenPrinter($PrinterName, [ref]$h, [IntPtr]::Zero)) {
    Write-Error "Cannot open printer: $PrinterName"
    exit 1
}
$di = New-Object DOCINFOA
$di.pDocName = "POS"
$di.pDataType = "RAW"
$job = [WinPrint]::StartDocPrinter($h, 1, [ref]$di)
if ($job -le 0) { [WinPrint]::ClosePrinter($h); Write-Error "StartDocPrinter failed"; exit 1 }
[WinPrint]::StartPagePrinter($h) | Out-Null
$written = 0
[WinPrint]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written) | Out-Null
[WinPrint]::EndPagePrinter($h) | Out-Null
[WinPrint]::EndDocPrinter($h) | Out-Null
[WinPrint]::ClosePrinter($h) | Out-Null
