'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, fmtDate } from '@/lib/utils'
import { printViaBridge, buildReceiptESCPOS, buildLabelTSPL, buildLabelESCPOS, kickDrawerViaBridge } from '@/lib/printBridge'

const SETTING_FIELDS = [
  { key:'shop_name',       label:'ชื่อร้าน',                         placeholder:'ร้านของฉัน' },
  { key:'shop_address',    label:'ที่อยู่ร้าน',                       placeholder:'เลขที่ ถนน อำเภอ จังหวัด' },
  { key:'shop_tax_id',     label:'เลขประจำตัวผู้เสียภาษี',           placeholder:'0-0000-00000-00-0' },
  { key:'shop_phone',      label:'เบอร์โทรศัพท์',                    placeholder:'080-000-0000' },
  { key:'promptpay_id',    label:'พร้อมเพย์ (เบอร์โทร หรือ เลข 13 หลัก)', placeholder:'0812345678 หรือ 1100000000000' },
  { key:'owner_name',      label:'ชื่อผู้ประกอบกิจการ (สำหรับภาษี)', placeholder:'นาย/นาง/นางสาว ชื่อ นามสกุล' },
  { key:'owner_id',        label:'เลขประจำตัวประชาชน (13 หลัก)',     placeholder:'1100000000000' },
  { key:'vat_rate',        label:'อัตรา VAT (%)',                     placeholder:'7 หรือ 0 (ถ้าไม่คิด VAT)' },
  { key:'ot_rate',         label:'อัตรา OT/ชม. (บาท)',               placeholder:'75' },
  { key:'receipt_footer',  label:'ข้อความท้ายใบเสร็จ',               placeholder:'ขอบคุณที่ใช้บริการ' },
  { key:'min_margin',           label:'กำไรขั้นต้ำ (%)',                   placeholder:'30 (ราคาขาย = ทุน × 1.3 อย่างน้อย)' },
  { key:'admin_pin',            label:'PIN เข้าโหมดแอดมิน (4 หลัก)',     placeholder:'ตัวเลข 4 หลัก เช่น 1234' },
  { key:'line_channel_token',   label:'LINE Channel Access Token',         placeholder:'วาง Long-lived token จาก LINE Developers' },
  { key:'line_group_id',        label:'LINE Group ID (บันทึกอัตโนมัติ)',   placeholder:'C... (ระบบกรอกให้เองเมื่อเพิ่ม Bot เข้ากลุ่ม)' },
  { key:'telegram_chat_id',     label:'Telegram Chat ID (กลุ่ม)',          placeholder:'-1001234567890 (ดูจาก @getidsbot)' },
]

const TABS = ['ตั้งค่าร้าน', 'เครื่องพิมพ์', 'ซัพพลายเออร์', 'ประวัติสต็อก', '🔓 ลิ้นชัก', '💰 พนักงาน']

const DEF_BILLDEE = { url: '', business_id: '', token: '', enabled: false }
function loadBillDeeConfig() {
  if (typeof window === 'undefined') return DEF_BILLDEE
  return JSON.parse(localStorage.getItem('billdee_config') || 'null') || DEF_BILLDEE
}

const DEF_BARCODE  = { name:'Barcode Printer', ip:'192.168.2.48', port:'9100', paper_width:'100', bridge_url:'', lang:'tspl', mac:'' }
const DEF_RECEIPT  = { name:'Receipt Printer', ip:'192.168.2.88', port:'9100', paper_width:'80',  bridge_url:'' }

function loadPrinters() {
  if (typeof window === 'undefined') return { barcode: DEF_BARCODE, receipt: DEF_RECEIPT }
  const origin = window.location.origin
  const saved = {
    barcode: JSON.parse(localStorage.getItem('printer_barcode') || 'null'),
    receipt: JSON.parse(localStorage.getItem('printer_receipt') || 'null'),
  }
  return {
    barcode: { ...DEF_BARCODE, bridge_url: origin, ...(saved.barcode || {}) },
    receipt: { ...DEF_RECEIPT, bridge_url: origin, ...(saved.receipt || {}) },
  }
}

export default function AdminPage() {
  const [authed, setAuthed]   = useState(() => typeof window !== 'undefined' && sessionStorage.getItem('admin_authed') === '1')
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinLoading, setPinLoading] = useState(false)

  const [tab, setTab]         = useState(0)
  const [settings, setSettings] = useState({})
  const [saved, setSaved]     = useState(false)
  const [customers, setCustomers] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [stockHist, setStockHist] = useState([])
  const [custModal, setCustModal] = useState(null)
  const [suppModal, setSuppModal] = useState(null)
  const [custForm, setCustForm] = useState({ code:'', name:'', phone:'', address:'', tax_id:'', credit_limit:'0' })
  const [suppForm, setSuppForm] = useState({ code:'', name:'', phone:'', address:'', tax_id:'' })
  const [saving, setSaving]   = useState(false)
  const [search, setSearch]   = useState('')
  const [printers, setPrinters] = useState(loadPrinters)
  const [printerSaved, setPrinterSaved] = useState(false)
  const [billdee, setBilldee] = useState(loadBillDeeConfig)
  const [billdeeStatus, setBilldeeStatus] = useState(null) // null | 'testing' | 'ok' | 'error'
  const [drawerLogs, setDrawerLogs]       = useState([])
  const [drawerAction, setDrawerAction]   = useState('') // 'opening'|'waking'|'ok'|'error'
  const [drawerMsg, setDrawerMsg]         = useState('')
  const [payroll, setPayroll]             = useState(null)
  const [payrollPeriod, setPayrollPeriod] = useState(() => new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}).slice(0,7))
  const [payrollLoading, setPayrollLoading] = useState(false)
  const [editRate, setEditRate]           = useState({})   // { [emp_id]: value }
  const [leaveTab, setLeaveTab]           = useState(null) // employee id for leave detail view
  const [logoUploading, setLogoUploading]     = useState(false)
  const [qrUploading, setQrUploading]         = useState(false)
  const [lineQrUploading, setLineQrUploading] = useState(false)

  useEffect(() => { if (authed) loadAll() }, [tab, authed])  // eslint-disable-line react-hooks/exhaustive-deps

  async function verifyPin() {
    if (!pinInput) return
    setPinLoading(true); setPinError('')
    try {
      const res = await fetch('/api/admin-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      })
      const json = await res.json()
      if (json.ok) {
        sessionStorage.setItem('admin_authed', '1')
        setAuthed(true)
      } else {
        setPinError('PIN ไม่ถูกต้อง')
        setPinInput('')
      }
    } catch {
      setPinError('เกิดข้อผิดพลาด กรุณาลองใหม่')
    } finally {
      setPinLoading(false)
    }
  }

  async function loadAll() {
    const { data: cfg } = await supabase.from('settings').select('*')
    if (cfg) setSettings(Object.fromEntries(cfg.map(r => [r.key, r.value])))
    if (tab === 2) {
      const { data } = await supabase.from('suppliers').select('*').order('name')
      setSuppliers(data || [])
    }
    if (tab === 3) {
      const { data } = await supabase.from('stock_history').select('*, products(name)').order('created_at', { ascending: false }).limit(100)
      setStockHist(data || [])
    }
    if (tab === 4) {
      const { data } = await supabase.from('drawer_logs').select('*').order('opened_at', { ascending: false }).limit(200)
      setDrawerLogs(data || [])
    }
    if (tab === 5) loadPayroll(payrollPeriod)
  }

  async function loadPayroll(period) {
    setPayrollLoading(true)
    try {
      const res  = await fetch(`/api/payroll?period=${period}`)
      const json = await res.json()
      if (!json.error) {
        setPayroll(json)
        // init edit rate values from employees
        const rates = {}
        for (const e of json.employees || []) rates[e.id] = String(e.daily_rate || '')
        setEditRate(rates)
      }
    } catch {}
    setPayrollLoading(false)
  }

  async function saveRate(empId) {
    const rate = Number(editRate[empId] || 0)
    await fetch('/api/payroll', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ employee_id: empId, daily_rate: rate }),
    })
    await loadPayroll(payrollPeriod)
  }

  async function uploadLogo(file) {
    setLogoUploading(true)
    try {
      const ext  = file.name.split('.').pop()
      const path = `shop-logo.${ext}`
      const { error: upErr } = await supabase.storage.from('shop-assets').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('shop-assets').getPublicUrl(path)
      const url = data.publicUrl + '?t=' + Date.now()
      const { error: setErr } = await supabase.from('settings').upsert({ key: 'shop_logo', value: url }, { onConflict: 'key' })
      if (setErr) throw setErr
      setSettings(p => ({ ...p, shop_logo: url }))
      alert('อัปโหลดโลโก้สำเร็จ')
    } catch (e) {
      alert('อัปโหลดไม่สำเร็จ: ' + e.message)
    } finally {
      setLogoUploading(false)
    }
  }

  async function uploadQR(file) {
    setQrUploading(true)
    try {
      const ext  = file.name.split('.').pop()
      const path = `payment-qr.${ext}`
      const { error: upErr } = await supabase.storage.from('shop-assets').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('shop-assets').getPublicUrl(path)
      const url = data.publicUrl + '?t=' + Date.now()
      const { error: setErr } = await supabase.from('settings').upsert({ key: 'payment_qr', value: url }, { onConflict: 'key' })
      if (setErr) throw setErr
      setSettings(p => ({ ...p, payment_qr: url }))
      alert('อัปโหลด QR สำเร็จ')
    } catch (e) {
      alert('อัปโหลดไม่สำเร็จ: ' + e.message)
    } finally {
      setQrUploading(false)
    }
  }

  async function uploadLineQR(file) {
    setLineQrUploading(true)
    try {
      const ext  = file.name.split('.').pop()
      const path = `line-qr.${ext}`
      const { error: upErr } = await supabase.storage.from('shop-assets').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('shop-assets').getPublicUrl(path)
      const url = data.publicUrl + '?t=' + Date.now()
      await supabase.from('settings').upsert({ key: 'line_qr', value: url }, { onConflict: 'key' })
      setSettings(p => ({ ...p, line_qr: url }))
      alert('อัปโหลด LINE QR สำเร็จ')
    } catch (e) {
      alert('อัปโหลดไม่สำเร็จ: ' + e.message)
    } finally {
      setLineQrUploading(false)
    }
  }

  async function saveSettings() {
    setSaving(true)
    try {
      const rows = Object.entries(settings).map(([key, value]) => ({ key, value }))
      const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' })
      if (error) throw error
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert('บันทึกไม่สำเร็จ: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function savePrinters() {
    localStorage.setItem('printer_barcode', JSON.stringify(printers.barcode))
    localStorage.setItem('printer_receipt', JSON.stringify(printers.receipt))
    try {
      const r1 = await supabase.from('settings').upsert({ key: 'printer_barcode', value: JSON.stringify(printers.barcode) }, { onConflict: 'key' })
      if (r1.error) throw r1.error
      const r2 = await supabase.from('settings').upsert({ key: 'printer_receipt', value: JSON.stringify(printers.receipt) }, { onConflict: 'key' })
      if (r2.error) throw r2.error
      setPrinterSaved(true)
      setTimeout(() => setPrinterSaved(false), 2000)
    } catch (e) {
      alert('บันทึกเครื่องพิมพ์ไม่สำเร็จ: ' + (e?.message || e))
    }
  }

  const [testReceiptStatus, setTestReceiptStatus] = useState(null)
  const [testBarcodeStatus, setTestBarcodeStatus] = useState(null)

  async function testPrintReceipt() {
    setTestReceiptStatus('printing')
    const cfg = printers.receipt
    const testReceipt = {
      receipt_no: 'TEST-001', created_at: new Date().toISOString(),
      shopName: settings.shop_name || 'ร้านทดสอบ',
      shopAddress: settings.shop_address || '', shopPhone: settings.shop_phone || '',
      shopLogo: settings.shop_logo || '', footer: settings.receipt_footer || 'ขอบคุณที่ใช้บริการ',
      subtotal: 150, discount: 0, vat: 0, total: 150, vatRate: 0,
      payment_amount: 200, change: 50,
      customerName: 'สมชาย ใจดี', customerPhone: '0812345678',
      items: [
        { name: 'สินค้าทดสอบ A', qty: 2, price: 50, disc: 0 },
        { name: 'สินค้าทดสอบ B', qty: 1, price: 50, disc: 0 },
      ],
    }
    try {
      if (cfg.ip) {
        const bytes = await buildReceiptESCPOS(testReceipt, parseInt(cfg.paper_width) || 80)
        await printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, bytes)
        setTestReceiptStatus('ok')
      } else {
        const html = buildTestReceiptHTML(testReceipt)
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
        window.open(URL.createObjectURL(blob))
        setTestReceiptStatus('ok')
      }
    } catch (e) {
      alert('ทดสอบพิมพ์ล้มเหลว: ' + e.message)
      setTestReceiptStatus('error')
    }
    setTimeout(() => setTestReceiptStatus(null), 3000)
  }

  async function testPrintBarcode() {
    setTestBarcodeStatus('printing')
    const cfg = printers.barcode
    const testItems = [
      { name: 'ทดสอบบาร์โค้ด', barcode: '1234567890123', price: 99.00 },
      { name: 'Test Product', barcode: 'TEST-001', price: 49.50 },
      { name: 'สินค้า ค', barcode: '9876543210', price: 199.00 },
    ]
    const SIZES = {
      '100': { id:'100x25x3', pw:102, ph:25, cols:3, lw:32, hGap:2, vGap:2, mx:1, my:0 },
      '58':  { id:'58x30',    pw:58,  ph:30, cols:1, lw:54, hGap:0, vGap:2, mx:2, my:2 },
      '40':  { id:'40x25',    pw:40,  ph:25, cols:1, lw:36, hGap:0, vGap:2, mx:2, my:2 },
    }
    const size = SIZES[cfg.paper_width] || SIZES['100']
    try {
      if (cfg.ip) {
        const useTspl = (cfg.lang || 'tspl') === 'tspl'
        const bytes = useTspl
          ? await buildLabelTSPL(testItems, size)
          : await buildLabelESCPOS(testItems, size, parseInt(cfg.paper_width) || 100)
        await printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, bytes)
        setTestBarcodeStatus('ok')
      } else {
        alert('ทดสอบบาร์โค้ดต้องตั้งค่า IP เครื่องพิมพ์ก่อน')
        setTestBarcodeStatus(null); return
      }
    } catch (e) {
      const msg = e.message || ''
      if (msg.includes('EHOSTDOWN') || msg.includes('EHOSTUNREACH') || msg.includes('ENETUNREACH'))
        alert('เครื่องพิมบาร์โค้ดปิดอยู่หรือไม่ได้ต่อเน็ต\nกรุณาเปิดเครื่องและลองใหม่')
      else if (msg.includes('ECONNREFUSED') || msg.includes('เชื่อมต่อ'))
        alert('เชื่อมต่อเครื่องพิมไม่ได้ (' + cfg.ip + ')\nตรวจสอบ IP และพอร์ตในตั้งค่า')
      else
        alert('ทดสอบพิมพ์บาร์โค้ดล้มเหลว: ' + msg)
      setTestBarcodeStatus('error')
    }
    setTimeout(() => setTestBarcodeStatus(null), 3000)
  }

  function buildTestReceiptHTML(r) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:16px;width:72mm;padding:4px 2px}
    .shop-logo{display:block;margin:0 auto 8px;max-width:60mm;max-height:32mm;object-fit:contain}
    h2{font-size:20px;font-weight:bold;text-align:center;margin-bottom:4px}.center{text-align:center;font-size:15px}
    hr{border:none;border-top:1px dashed #888;margin:6px 0}table{width:100%;border-collapse:collapse}
    .total-row td{font-size:17px;font-weight:bold;padding-top:6px}.footer{text-align:center;margin-top:10px;font-size:15px}
    .test-banner{background:#000;color:#fff;text-align:center;font-size:13px;padding:3px;margin-bottom:4px}
    @media print{body{margin:0;padding:2px}}</style></head><body>
    <div class="test-banner">⚙️ ทดสอบการพิมพ์</div>
    ${r.shopLogo ? `<img class="shop-logo" src="${r.shopLogo}" />` : ''}
    <h2>${r.shopName}</h2>
    ${r.shopAddress ? `<p class="center">${r.shopAddress}</p>` : ''}
    ${r.shopPhone ? `<p class="center">โทร: ${r.shopPhone}</p>` : ''}
    <hr><p class="center">เลขที่: ${r.receipt_no}</p>
    <p class="center">${new Date(r.created_at).toLocaleString('th-TH')}</p>
    ${r.customerName ? `<p class="center">ลูกค้า: ${r.customerName}${r.customerPhone ? ` (${r.customerPhone})` : ''}</p>` : ''}
    <hr>
    <table>${r.items.map(i => `<tr><td style="font-size:16px;padding:4px 0">${i.name}</td><td style="text-align:right;font-size:16px">${i.qty}×${i.price.toFixed(2)}</td><td style="text-align:right;font-size:16px">${(i.price*i.qty).toFixed(2)}</td></tr>`).join('')}</table>
    <hr><table>
    <tr class="total-row"><td>สุทธิ</td><td style="text-align:right">฿${r.total.toFixed(2)}</td></tr>
    <tr><td>รับเงิน</td><td style="text-align:right">฿${r.payment_amount.toFixed(2)}</td></tr>
    <tr><td>ทอน</td><td style="text-align:right">฿${r.change.toFixed(2)}</td></tr>
    </table><hr>
    <div class="footer">${r.footer}</div>
    <script>window.onload=()=>{window.focus();window.print()}</script>
    </body></html>`
  }

  async function handleOpenDrawer() {
    const cfg = printers.receipt
    if (!cfg?.ip) return alert('ยังไม่ได้ตั้งค่า IP เครื่องพิมในแท็บ เครื่องพิมพ์')
    setDrawerAction('opening'); setDrawerMsg('')
    try {
      await kickDrawerViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100)
      await supabase.from('drawer_logs').insert({ employee_name: 'แอดมิน', note: 'เปิดด้วยตนเอง (หลังบ้าน)' })
      setDrawerAction('ok'); setDrawerMsg('เปิดลิ้นชักสำเร็จ ✓')
      const { data } = await supabase.from('drawer_logs').select('*').order('opened_at', { ascending: false }).limit(200)
      setDrawerLogs(data || [])
    } catch (e) {
      setDrawerAction('error'); setDrawerMsg('ไม่สามารถเปิดลิ้นชักได้: ' + (e?.message || 'error'))
    } finally {
      setTimeout(() => setDrawerAction(''), 4000)
    }
  }

  async function handleWakePrinter() {
    const cfg = printers.receipt
    if (!cfg?.ip) return alert('ยังไม่ได้ตั้งค่า IP เครื่องพิมในแท็บ เครื่องพิมพ์')
    setDrawerAction('waking'); setDrawerMsg('')
    try {
      const bytes = new Uint8Array([0x1B, 0x40, 0x0A, 0x1D, 0x56, 0x42, 0x00])
      await printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, bytes)
      setDrawerAction('ok'); setDrawerMsg('ปลุกใบเสร็จสำเร็จ ✓')
    } catch (e) {
      setDrawerAction('error'); setDrawerMsg('ไม่สามารถปลุกใบเสร็จได้: ' + (e?.message || 'error'))
    } finally {
      setTimeout(() => setDrawerAction(''), 4000)
    }
  }

  async function handleWakeBarcode() {
    const cfg = printers.barcode
    if (!cfg?.ip) return alert('ยังไม่ได้ตั้งค่า IP เครื่องพิมบาร์โค้ดในแท็บ เครื่องพิมพ์')
    setDrawerAction('waking-barcode'); setDrawerMsg('')
    try {
      // TSPL: ส่งแค่ SIZE+GAP (ไม่ PRINT) เพื่อปลุกโดยไม่พิมอะไร
      const wake = 'SIZE 100 mm, 25 mm\r\nGAP 3 mm, 0 mm\r\n'
      const bytes = new TextEncoder().encode(wake)
      await printViaBridge(cfg.bridge_url || '', cfg.ip, cfg.port || 9100, bytes)
      setDrawerAction('ok'); setDrawerMsg('ปลุกบาร์โค้ดสำเร็จ ✓')
    } catch (e) {
      setDrawerAction('error'); setDrawerMsg('ไม่สามารถปลุกบาร์โค้ดได้: ' + (e?.message || 'error'))
    } finally {
      setTimeout(() => setDrawerAction(''), 4000)
    }
  }

  function saveBillDee() {
    localStorage.setItem('billdee_config', JSON.stringify(billdee))
    alert('บันทึกการตั้งค่า BillDEE Sync แล้ว')
  }

  async function testBillDeeSync() {
    if (!billdee.url || !billdee.business_id || !billdee.token) {
      return alert('กรุณากรอก URL, Business ID และ Sync Token ก่อน')
    }
    setBilldeeStatus('testing')
    try {
      const endpoint = billdee.url.replace(/\/$/, '') + '/api/pos-sync'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-POS-Token': billdee.token },
        body: JSON.stringify({
          business_id: billdee.business_id,
          receipt_no: 'TEST-' + Date.now(),
          total: 1,
          sale_date: new Date().toISOString().slice(0, 10),
          payment_method: 'test',
          shop_name: 'POS Test',
          items: [{ product_name: 'Test Item', qty: 1 }],
          _test: true,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok || json.error === 'already_synced') {
        setBilldeeStatus('ok')
      } else {
        setBilldeeStatus('error')
        console.error('BillDEE sync test error:', json)
      }
    } catch (e) {
      setBilldeeStatus('error')
      console.error('BillDEE sync test exception:', e)
    }
  }

  async function saveCustomer() {
    if (!custForm.name) return alert('กรุณากรอกชื่อลูกค้า')
    setSaving(true)
    try {
      const payload = { ...custForm, credit_limit: parseFloat(custForm.credit_limit) || 0 }
      if (custModal === 'add') await supabase.from('customers').insert(payload)
      else await supabase.from('customers').update(payload).eq('id', custModal.id)
      setCustModal(null)
      const { data } = await supabase.from('customers').select('*').order('name')
      setCustomers(data || [])
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  async function saveSupplier() {
    if (!suppForm.name) return alert('กรุณากรอกชื่อซัพพลายเออร์')
    setSaving(true)
    const payload = {
      name: suppForm.name.trim(),
      code: suppForm.code.trim() || null,
      phone: suppForm.phone.trim() || null,
      address: suppForm.address.trim() || null,
      tax_id: suppForm.tax_id.trim() || null,
    }
    try {
      if (suppModal === 'add') await supabase.from('suppliers').insert(payload)
      else await supabase.from('suppliers').update(payload).eq('id', suppModal.id)
      setSuppModal(null)
      const { data } = await supabase.from('suppliers').select('*').order('name')
      setSuppliers(data || [])
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  const filteredCust = customers.filter(c => !search || c.name.includes(search) || (c.phone||'').includes(search))
  const filteredSupp = suppliers.filter(s => !search || s.name.includes(search) || (s.phone||'').includes(search))

  if (!authed) return (
    <div className="page flex items-center justify-center min-h-[70vh]">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 w-full max-w-xs text-center">
        <div className="text-4xl mb-3">🔐</div>
        <h2 className="font-bold text-lg text-slate-800 mb-1">หน้าแอดมิน</h2>
        <p className="text-sm text-slate-400 mb-6">ใส่ PIN เพื่อเข้าใช้งาน</p>
        <input
          type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8}
          value={pinInput} onChange={e => { setPinInput(e.target.value); setPinError('') }}
          onKeyDown={e => e.key === 'Enter' && verifyPin()}
          placeholder="PIN" autoFocus
          className="field text-center text-xl tracking-widest w-full mb-3"
        />
        {pinError && <p className="text-red-500 text-sm mb-3">{pinError}</p>}
        <button onClick={verifyPin} disabled={pinLoading || !pinInput}
          className="btn-primary w-full">
          {pinLoading ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="page">
      <h1 className="font-heading font-bold text-xl text-slate-800 mb-5">⚙️ หลังบ้าน / ตั้งค่า</h1>

      {/* Tab bar */}
      <div className="flex gap-1.5 mb-5 overflow-x-auto scroll-hidden pb-1">
        {TABS.map((t, i) => (
          <button key={i} onClick={() => { setTab(i); setSearch('') }}
            className={`shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all
              ${tab === i ? 'bg-brand text-white border-brand shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>{t}</button>
        ))}
      </div>

      {/* ── Shop settings ── */}
      {tab === 0 && (
        <div className="card-pad space-y-4 max-w-xl">
          <h2 className="font-heading font-semibold text-slate-700 text-base">ข้อมูลร้านค้า</h2>
          {/* Logo upload */}
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">โลโก้ร้าน (แสดงบนใบเสร็จ)</label>
            <div className="flex items-center gap-3">
              {settings.shop_logo && (
                <img src={settings.shop_logo} alt="logo" className="h-14 w-14 object-contain border border-slate-200 rounded-xl bg-white p-1" />
              )}
              <label className={`cursor-pointer px-4 py-2 rounded-xl border-2 border-dashed text-sm font-semibold transition-all
                ${logoUploading ? 'border-slate-300 text-slate-400' : 'border-brand/40 text-brand hover:bg-brand/5'}`}>
                {logoUploading ? 'กำลังอัปโหลด...' : settings.shop_logo ? '🔄 เปลี่ยนรูป' : '📷 อัปโหลดโลโก้'}
                <input type="file" accept="image/*" className="hidden" disabled={logoUploading}
                  onChange={e => e.target.files[0] && uploadLogo(e.target.files[0])} />
              </label>
            </div>
          </div>

          {/* LINE QR upload */}
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">QR LINE OA (แสดงบนใบเสร็จ)</label>
            <div className="flex items-center gap-3">
              {settings.line_qr && (
                <img src={settings.line_qr} alt="LINE QR" className="h-20 w-20 object-contain border border-slate-200 rounded-xl bg-white p-1" />
              )}
              <label className={`cursor-pointer px-4 py-2 rounded-xl border-2 border-dashed text-sm font-semibold transition-all
                ${lineQrUploading ? 'border-slate-300 text-slate-400' : 'border-brand/40 text-brand hover:bg-brand/5'}`}>
                {lineQrUploading ? 'กำลังอัปโหลด...' : settings.line_qr ? '🔄 เปลี่ยน LINE QR' : '📷 อัปโหลด LINE QR'}
                <input type="file" accept="image/*" className="hidden" disabled={lineQrUploading}
                  onChange={e => e.target.files[0] && uploadLineQR(e.target.files[0])} />
              </label>
            </div>
          </div>

          {/* QR payment upload */}
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">QR รับเงิน (แสดงตอนเลือกจ่ายด้วย QR)</label>
            <div className="flex items-center gap-3">
              {settings.payment_qr && (
                <img src={settings.payment_qr} alt="QR" className="h-20 w-20 object-contain border border-slate-200 rounded-xl bg-white p-1" />
              )}
              <label className={`cursor-pointer px-4 py-2 rounded-xl border-2 border-dashed text-sm font-semibold transition-all
                ${qrUploading ? 'border-slate-300 text-slate-400' : 'border-brand/40 text-brand hover:bg-brand/5'}`}>
                {qrUploading ? 'กำลังอัปโหลด...' : settings.payment_qr ? '🔄 เปลี่ยน QR' : '📷 อัปโหลด QR'}
                <input type="file" accept="image/*" className="hidden" disabled={qrUploading}
                  onChange={e => e.target.files[0] && uploadQR(e.target.files[0])} />
              </label>
            </div>
          </div>

          {SETTING_FIELDS.map(f => (
            <div key={f.key}>
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">{f.label}</label>
              <input value={settings[f.key] || ''} onChange={e => setSettings(p => ({...p, [f.key]: e.target.value}))}
                placeholder={f.placeholder} className="field w-full"
                readOnly={f.key === 'line_group_id' && !!settings.line_group_id} />
            </div>
          ))}

          {/* Telegram Webhook */}
          <TelegramWebhookSetup />

          {/* LINE Bot setup guide */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-xs text-green-800 space-y-1.5">
            <p className="font-bold text-sm">📲 วิธีตั้งค่าแจ้งเตือน LINE กลุ่ม</p>
            <p>1. ไปที่ <span className="font-mono bg-white/70 px-1 rounded">developers.line.biz</span> → สร้าง Provider → Create Messaging API channel</p>
            <p>2. ไปที่ Basic settings → Issue <strong>Long-lived channel access token</strong> → คัดลอกใส่ช่องด้านบน</p>
            <p>3. ไปที่ Messaging API settings → Webhook URL ใส่:</p>
            <p className="font-mono bg-white/70 px-2 py-1 rounded select-all break-all">
              {typeof window !== 'undefined' ? window.location.origin : 'https://your-domain'}/api/line-webhook
            </p>
            <p>4. เปิด <strong>Use webhook</strong> → <strong>เพิ่ม Bot เข้ากลุ่ม LINE</strong> ที่ต้องการ</p>
            <p>5. ส่งข้อความใดก็ได้ในกลุ่ม → ระบบจะดึง Group ID ให้อัตโนมัติ → บันทึกการตั้งค่า</p>
            {settings.line_group_id && <p className="text-green-700 font-semibold">✅ Group ID: {settings.line_group_id}</p>}
            {settings.line_channel_token && !settings.line_group_id && <p className="text-amber-600">⏳ รอ Group ID — เพิ่ม Bot เข้ากลุ่มก่อน</p>}
          </div>

          <button onClick={saveSettings} disabled={saving}
            className={`w-full py-3.5 rounded-xl text-sm font-bold transition-all shadow active:scale-95
              ${saved ? 'bg-emerald-600 text-white' : 'btn-primary'}`}>
            {saved ? '✓ บันทึกแล้ว' : saving ? 'กำลังบันทึก...' : '💾 บันทึกการตั้งค่า'}
          </button>
        </div>
      )}

      {/* ── Printer settings ── */}
      {tab === 1 && (
        <div className="space-y-5 max-w-xl">
          {/* Barcode printer */}
          <div className="card-pad space-y-4">
            <div className="flex items-center gap-3 pb-2 border-b border-slate-100">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-xl">🏷️</div>
              <div className="flex-1">
                <h2 className="font-heading font-semibold text-slate-800">เครื่องปริ้นสติ๊กเกอร์บาร์โค้ด</h2>
                <p className="text-xs text-slate-400">เชื่อมต่อผ่าน WiFi / IP</p>
              </div>
            </div>
            <PrinterFields
              values={printers.barcode}
              onChange={v => setPrinters(p => ({...p, barcode: {...p.barcode, ...v}}))}
              paperOptions={[{v:'100',l:'100mm (3 ดวง/แถว)'},{v:'58',l:'58mm (มาตรฐาน)'},{v:'40',l:'40mm (แคบ)'}]}
              showMac
            />
            <button onClick={testPrintBarcode} disabled={testBarcodeStatus === 'printing'}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold border transition-all active:scale-95 disabled:opacity-50
                ${testBarcodeStatus === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' :
                  testBarcodeStatus === 'error' ? 'bg-red-50 border-red-300 text-red-700' :
                  'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'}`}>
              {testBarcodeStatus === 'printing' ? '⏳ กำลังพิมพ์...' :
               testBarcodeStatus === 'ok' ? '✅ พิมพ์สำเร็จ' :
               testBarcodeStatus === 'error' ? '❌ พิมพ์ไม่ได้' : '🖨️ ทดสอบพิมพ์บาร์โค้ด'}
            </button>
          </div>

          {/* Receipt printer */}
          <div className="card-pad space-y-4">
            <div className="flex items-center gap-3 pb-2 border-b border-slate-100">
              <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-xl">🧾</div>
              <div className="flex-1">
                <h2 className="font-heading font-semibold text-slate-800">เครื่องปริ้นใบเสร็จ</h2>
                <p className="text-xs text-slate-400">เชื่อมต่อผ่าน WiFi / IP</p>
              </div>
            </div>
            <PrinterFields
              values={printers.receipt}
              onChange={v => setPrinters(p => ({...p, receipt: {...p.receipt, ...v}}))}
              paperOptions={[{v:'80',l:'80mm (มาตรฐาน)'},{v:'58',l:'58mm (แคบ)'}]}
            />
            <button onClick={testPrintReceipt} disabled={testReceiptStatus === 'printing'}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold border transition-all active:scale-95 disabled:opacity-50
                ${testReceiptStatus === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' :
                  testReceiptStatus === 'error' ? 'bg-red-50 border-red-300 text-red-700' :
                  'bg-brand-50 border-brand/20 text-brand-mid hover:bg-brand-50'}`}>
              {testReceiptStatus === 'printing' ? '⏳ กำลังพิมพ์...' :
               testReceiptStatus === 'ok' ? '✅ พิมพ์สำเร็จ' :
               testReceiptStatus === 'error' ? '❌ พิมพ์ไม่ได้' : '🖨️ ทดสอบพิมพ์ใบเสร็จ'}
            </button>
          </div>



          <button onClick={savePrinters}
            className={`w-full py-3.5 rounded-xl text-sm font-bold transition-all shadow active:scale-95
              ${printerSaved ? 'bg-emerald-600 text-white' : 'btn-primary'}`}>
            {printerSaved ? '✓ บันทึกแล้ว' : '💾 บันทึกการตั้งค่าเครื่องพิมพ์'}
          </button>
        </div>
      )}

      {/* ── Suppliers ── */}
      {tab === 2 && (
        <div>
          <div className="flex gap-2 mb-3">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาซัพพลายเออร์"
              className="field flex-1" />
            <button onClick={() => { setSuppForm({ code:'', name:'', phone:'', address:'', tax_id:'' }); setSuppModal('add') }}
              className="btn-primary shrink-0">+ เพิ่มซัพพลายเออร์</button>
          </div>
          <div className="card overflow-hidden">
            <div className="divide-y divide-slate-50">
              {filteredSupp.map(s => (
                <div key={s.id} className="px-4 py-3 flex justify-between items-center hover:bg-slate-50">
                  <div>
                    <p className="font-semibold text-sm text-slate-800">{s.name}</p>
                    <p className="text-xs text-slate-400">{s.phone || '—'} {s.tax_id ? '· เลขภาษี: '+s.tax_id : ''}</p>
                  </div>
                  <button onClick={() => { setSuppForm({ ...s }); setSuppModal({ id: s.id }) }}
                    className="text-xs text-brand border border-brand/30 px-3 py-1.5 rounded-lg active:bg-brand/5">แก้ไข</button>
                </div>
              ))}
              {filteredSupp.length === 0 && <div className="text-center py-10 text-slate-400 text-sm">ไม่พบซัพพลายเออร์</div>}
            </div>
          </div>
        </div>
      )}

      {/* ── Stock history ── */}
      {tab === 3 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-500 border-b border-slate-100">
                <th className="text-left px-4 py-3 font-semibold">สินค้า</th>
                <th className="text-left px-3 py-3 font-semibold">ประเภท</th>
                <th className="text-right px-3 py-3 font-semibold">ก่อน</th>
                <th className="text-right px-3 py-3 font-semibold">เปลี่ยน</th>
                <th className="text-right px-3 py-3 font-semibold">หลัง</th>
                <th className="text-left px-4 py-3 font-semibold">วันที่</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {stockHist.map(h => (
                  <tr key={h.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-700 font-medium">{h.products?.name || h.product_id}</td>
                    <td className="px-3 py-2.5">
                      <span className={h.type==='sale' ? 'badge-red' : h.type==='po_receive' ? 'badge-green' : 'badge-blue'}>
                        {h.type==='sale' ? 'ขาย' : h.type==='po_receive' ? 'รับ PO' : h.type==='adjust_in' ? '+สต็อก' : '-สต็อก'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-400">{h.qty_before}</td>
                    <td className={`px-3 py-2.5 text-right font-bold ${Number(h.qty_change) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {Number(h.qty_change) > 0 ? '+' : ''}{h.qty_change}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{h.qty_after}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{fmtDate(h.created_at)}</td>
                  </tr>
                ))}
                {stockHist.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-400">ยังไม่มีประวัติ</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ลิ้นชัก ── */}
      {tab === 4 && (
        <div className="space-y-3 max-w-2xl">
          {/* Quick actions */}
          <div className="card-pad flex flex-wrap gap-3 items-center">
            <button onClick={handleOpenDrawer} disabled={!!drawerAction}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
              {drawerAction === 'opening' ? '⏳' : '🔓'} เรียกลิ้นชัก
            </button>
            <button onClick={handleWakePrinter} disabled={!!drawerAction}
              className="btn-secondary px-4 py-2 text-sm disabled:opacity-50">
              {drawerAction === 'waking' ? '⏳' : '🖨️'} ปลุกใบเสร็จ
            </button>
            <button onClick={handleWakeBarcode} disabled={!!drawerAction}
              className="btn-secondary px-4 py-2 text-sm disabled:opacity-50">
              {drawerAction === 'waking-barcode' ? '⏳' : '🏷️'} ปลุกบาร์โค้ด
            </button>
            {drawerAction && (
              <span className={`text-sm font-medium ${drawerAction === 'ok' ? 'text-emerald-600' : drawerAction === 'error' ? 'text-red-500' : 'text-slate-400'}`}>
                {drawerAction === 'opening' ? 'กำลังเปิดลิ้นชัก...' : drawerAction === 'waking' ? 'กำลังปลุกใบเสร็จ...' : drawerAction === 'waking-barcode' ? 'กำลังปลุกบาร์โค้ด...' : drawerMsg}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-semibold text-slate-800">ประวัติการเปิดลิ้นชักด้วยตนเอง</h2>
            <span className="text-xs text-slate-400">{drawerLogs.length} รายการล่าสุด</span>
          </div>
          {drawerLogs.length === 0 ? (
            <div className="card-pad text-center py-12 text-slate-400 text-sm">
              <div className="text-4xl mb-2 opacity-20">🔓</div>
              ยังไม่มีประวัติ
            </div>
          ) : (
            <div className="card-pad p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">วันเวลา</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">พนักงาน</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">จำนวน</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {drawerLogs.map(log => {
                    const dt = new Date(log.opened_at)
                    const dtStr = dt.toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric' })
                      + ' ' + dt.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
                    const isOut = (log.note || '').includes('เบิกเงินออก')
                    return (
                      <tr key={log.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 text-slate-600 font-mono text-xs whitespace-nowrap">{dtStr}</td>
                        <td className="px-4 py-3 font-semibold text-slate-700">{log.employee_name || <span className="text-slate-300">ไม่ระบุ</span>}</td>
                        <td className="px-4 py-3 text-right font-bold text-sm whitespace-nowrap">
                          {log.amount ? (
                            <span className={isOut ? 'text-red-500' : 'text-emerald-600'}>
                              {isOut ? '−' : '+'}฿{Number(log.amount).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{log.note || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── พนักงาน / Payroll ── */}
      {tab === 5 && (
        <div className="space-y-4 max-w-3xl">
          {/* Period selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-heading font-semibold text-slate-800">เงินเดือนพนักงาน</h2>
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={() => {
                const [y,m] = payrollPeriod.split('-').map(Number)
                const d = new Date(y, m-2, 1)
                const p = d.toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}).slice(0,7)
                setPayrollPeriod(p); loadPayroll(p)
              }} className="btn-secondary text-sm px-3 py-2">‹</button>
              <input type="month" value={payrollPeriod}
                onChange={e => { setPayrollPeriod(e.target.value); loadPayroll(e.target.value) }}
                className="field text-sm" />
              <button onClick={() => {
                const [y,m] = payrollPeriod.split('-').map(Number)
                const d = new Date(y, m, 1)
                const p = d.toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}).slice(0,7)
                setPayrollPeriod(p); loadPayroll(p)
              }} className="btn-secondary text-sm px-3 py-2">›</button>
              <button onClick={() => loadPayroll(payrollPeriod)}
                className="btn-secondary text-sm px-3 py-2">↻</button>
            </div>
          </div>

          {payrollLoading && (
            <div className="text-center py-12 text-slate-400 text-sm">กำลังโหลด…</div>
          )}

          {!payrollLoading && payroll && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="card-pad text-center">
                  <p className="text-2xl font-bold text-brand">{payroll.employees?.length || 0}</p>
                  <p className="text-xs text-slate-400 mt-0.5">พนักงาน</p>
                </div>
                <div className="card-pad text-center">
                  <p className="text-2xl font-bold text-green-600">
                    ฿{(payroll.employees||[]).reduce((s,e)=>s+e.grossPay,0).toLocaleString('th-TH')}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">รวมค่าแรง</p>
                </div>
                <div className="card-pad text-center">
                  <p className="text-2xl font-bold text-amber-600">
                    ฿{(payroll.employees||[]).reduce((s,e)=>s+e.advTotal,0).toLocaleString('th-TH')}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">รวมเบิก</p>
                </div>
              </div>

              {/* Employee rows */}
              <div className="space-y-3">
                {(payroll.employees||[]).map(emp => (
                  <div key={emp.id} className="card-pad space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-800">{emp.nickname || emp.name}</p>
                        <p className="text-xs text-slate-400">{emp.position || 'พนักงาน'}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                          {emp.phone && <p className="text-xs text-slate-500">📱 {emp.phone}</p>}
                          {emp.password && <p className="text-xs text-slate-500">🔑 {'•'.repeat(emp.password.length)}</p>}
                          {emp.pin && <p className="text-xs text-slate-500">🔢 PIN: {'•'.repeat(emp.pin.length)}</p>}
                        </div>
                      </div>
                      {/* Edit daily rate */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400 whitespace-nowrap">฿/วัน</span>
                        <input type="number" value={editRate[emp.id] ?? ''} min="0"
                          onChange={e => setEditRate(p => ({...p, [emp.id]: e.target.value}))}
                          onBlur={() => saveRate(emp.id)}
                          className="field w-24 text-right text-sm font-bold" placeholder="0" />
                      </div>
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-3 gap-2 text-center text-sm">
                      <div className="bg-slate-50 rounded-xl py-2">
                        <p className="font-bold text-slate-700">{emp.daysWorked}</p>
                        <p className="text-xs text-slate-400">วันทำงาน</p>
                      </div>
                      <div className="bg-green-50 rounded-xl py-2">
                        <p className="font-bold text-green-700">฿{emp.grossPay.toLocaleString('th-TH')}</p>
                        <p className="text-xs text-slate-400">ค่าแรงรวม{emp.streakBonus > 0 ? ' +โบนัส' : ''}</p>
                      </div>
                      <div className={`rounded-xl py-2 ${emp.netPay > 0 ? 'bg-blue-50' : 'bg-red-50'}`}>
                        <p className={`font-bold ${emp.netPay > 0 ? 'text-blue-700' : 'text-red-600'}`}>
                          ฿{emp.netPay.toLocaleString('th-TH')}
                        </p>
                        <p className="text-xs text-slate-400">จ่ายสุทธิ</p>
                      </div>
                    </div>

                    {/* Bonus badge */}
                    {emp.streakBonus > 0 && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 text-xs text-yellow-700 font-semibold">
                        ⭐ โบนัสมาครบ 10 วัน +฿{emp.streakBonus.toLocaleString('th-TH')}
                      </div>
                    )}

                    {/* Advance detail */}
                    {emp.advTotal > 0 && (
                      <div className="bg-amber-50 rounded-xl px-3 py-2 text-xs text-amber-700">
                        <span className="font-semibold">เบิกล่วงหน้า ฿{emp.advTotal.toLocaleString('th-TH')}</span>
                        {emp.overDraw > 0 && (
                          <span className="ml-2 text-red-600 font-bold">
                            · เบิกเกิน ฿{emp.overDraw.toLocaleString('th-TH')} (ต้องหัก {emp.daysToDeduct} วันถัดไป)
                          </span>
                        )}
                      </div>
                    )}

                    {/* Leave this period */}
                    {emp.leaves?.length > 0 && (
                      <div className="border-t border-slate-100 pt-2">
                        <p className="text-xs font-semibold text-slate-500 mb-1.5">การลาเดือนนี้</p>
                        <div className="flex flex-wrap gap-1.5">
                          {emp.leaves.map((l, i) => {
                            const from = new Date(l.date_from+'T00:00:00').toLocaleDateString('th-TH',{day:'numeric',month:'short'})
                            const to   = l.date_to !== l.date_from
                              ? ' – ' + new Date(l.date_to+'T00:00:00').toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : ''
                            const period = l.leave_period === 'morning' ? '(เช้า)' : l.leave_period === 'afternoon' ? '(บ่าย)' : ''
                            const statusCls = l.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                            return (
                              <span key={i} className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusCls}`}>
                                {from}{to} {period}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ── ตารางลาแบบปฏิทินเต็มเดือน ── */}
              {(() => {
                const [yr, mo] = payrollPeriod.split('-').map(Number)
                const daysInMonth = new Date(yr, mo, 0).getDate()
                const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
                const employees = payroll.employees || []

                function getDayInfo(emp, day) {
                  const d = `${payrollPeriod}-${String(day).padStart(2,'0')}`
                  const leave = (emp.leaves||[]).find(l =>
                    l.status !== 'cancelled' && l.date_from <= d && l.date_to >= d
                  )
                  const att = (emp.attendance||[]).find(a => a.date === d)
                  if (leave?.status === 'approved') return 'leave'
                  if (leave?.status === 'pending')  return 'pending'
                  if (att?.check_in)                return 'work'
                  return 'none'
                }

                const dayOfWeek = d => new Date(yr, mo-1, d).getDay() // 0=Sun,6=Sat

                return (
                  <div className="card-pad">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <h3 className="font-heading font-semibold text-slate-700 text-sm">📅 ปฏิทินการลา — {payrollPeriod}</h3>
                      <div className="flex gap-2 text-xs ml-auto flex-wrap">
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-400 inline-block"></span>มาทำงาน</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400 inline-block"></span>ลา</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-300 inline-block"></span>รออนุมัติ</span>
                      </div>
                    </div>
                    <div className="overflow-x-auto -mx-4 px-4">
                      <table className="text-xs border-separate border-spacing-0.5" style={{minWidth: daysInMonth*28+120}}>
                        <thead>
                          <tr>
                            <th className="text-left py-1 pr-2 text-slate-500 font-semibold sticky left-0 bg-white z-10 min-w-[80px]">พนักงาน</th>
                            {days.map(d => {
                              const dow = dayOfWeek(d)
                              const isWeekend = dow === 0 || dow === 6
                              return (
                                <th key={d} className={`w-6 text-center font-semibold pb-1 ${isWeekend ? 'text-red-400' : 'text-slate-400'}`}>
                                  {d}
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {employees.map(emp => (
                            <tr key={emp.id}>
                              <td className="py-0.5 pr-2 font-semibold text-slate-700 whitespace-nowrap sticky left-0 bg-white z-10">
                                {emp.nickname || emp.name}
                              </td>
                              {days.map(d => {
                                const type = getDayInfo(emp, d)
                                const dow  = dayOfWeek(d)
                                const isWeekend = dow === 0 || dow === 6
                                const cell = {
                                  work:    { bg: 'bg-green-400',  title: 'มาทำงาน', text: '' },
                                  leave:   { bg: 'bg-red-400',    title: 'ลา (อนุมัติ)', text: 'ล' },
                                  pending: { bg: 'bg-amber-300',  title: 'ขอลา (รออนุมัติ)', text: '?' },
                                  none:    { bg: isWeekend ? 'bg-slate-100' : 'bg-slate-50', title: '', text: '' },
                                }[type]
                                return (
                                  <td key={d} title={cell.title}
                                    className={`w-6 h-5 rounded text-center leading-5 font-bold text-white ${cell.bg} ${type === 'none' ? 'text-slate-300' : ''}`}>
                                    {cell.text}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}
            </>
          )}
        </div>
      )}

      {/* Customer Modal */}
      {custModal && (
        <Modal title={custModal === 'add' ? 'เพิ่มลูกค้า' : 'แก้ไขลูกค้า'} onClose={() => setCustModal(null)}>
          <div className="space-y-3">
            {[['code','รหัส'],['name','ชื่อ *'],['phone','เบอร์โทร'],['address','ที่อยู่'],['tax_id','เลขภาษี'],['credit_limit','วงเงินเชื่อ']].map(([k,l]) => (
              <div key={k}>
                <label className="text-xs font-semibold text-slate-500 block mb-1">{l}</label>
                <input value={custForm[k]||''} onChange={e => setCustForm(p=>({...p,[k]:e.target.value}))}
                  type={k==='credit_limit'?'number':'text'} className="field w-full" />
              </div>
            ))}
            <ModalActions onCancel={() => setCustModal(null)} onSave={saveCustomer} saving={saving} />
          </div>
        </Modal>
      )}

      {/* Supplier Modal */}
      {suppModal && (
        <Modal title={suppModal === 'add' ? 'เพิ่มซัพพลายเออร์' : 'แก้ไขซัพพลายเออร์'} onClose={() => setSuppModal(null)}>
          <div className="space-y-3">
            {[['code','รหัส'],['name','ชื่อ *'],['phone','เบอร์โทร'],['address','ที่อยู่'],['tax_id','เลขภาษี']].map(([k,l]) => (
              <div key={k}>
                <label className="text-xs font-semibold text-slate-500 block mb-1">{l}</label>
                <input value={suppForm[k]||''} onChange={e => setSuppForm(p=>({...p,[k]:e.target.value}))} className="field w-full" />
              </div>
            ))}
            <ModalActions onCancel={() => setSuppModal(null)} onSave={saveSupplier} saving={saving} />
          </div>
        </Modal>
      )}
    </div>
  )
}

function PrinterFields({ values, onChange, paperOptions, showMac = false }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-semibold text-slate-500 block mb-1.5">ชื่อเครื่องพิมพ์</label>
        <input value={values.name} onChange={e => onChange({ name: e.target.value })} className="field w-full" placeholder="เช่น Barcode Printer 1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-500 block mb-1.5">IP Address</label>
          <input value={values.ip} onChange={e => onChange({ ip: e.target.value })}
            className="field w-full" placeholder="192.168.1.100" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 block mb-1.5">Port</label>
          <input value={values.port} onChange={e => onChange({ port: e.target.value })}
            className="field w-full" placeholder="9100" type="number" />
        </div>
      </div>
      {showMac && (
        <div>
          <label className="text-xs font-semibold text-slate-500 block mb-1.5">
            MAC Address <span className="font-normal text-slate-400">(สำหรับค้นหา IP อัตโนมัติ)</span>
          </label>
          <input value={values.mac || ''} onChange={e => onChange({ mac: e.target.value.trim() })}
            className="field w-full font-mono text-xs" placeholder="24:4c:ab:56:b5:34" />
          <p className="text-[10px] text-slate-400 mt-1">ดูได้จากสติ๊กเกอร์ใต้เครื่องพิมพ์</p>
        </div>
      )}
      <div>
        <label className="text-xs font-semibold text-slate-500 block mb-1.5">ความกว้างกระดาษ</label>
        <div className="flex gap-2">
          {paperOptions.map(o => (
            <button key={o.v} onClick={() => onChange({ paper_width: o.v })}
              className={`flex-1 py-2 rounded-xl border-2 text-xs font-semibold transition-all
                ${values.paper_width === o.v ? 'border-brand bg-brand/5 text-brand' : 'border-slate-200 text-slate-500'}`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-500 block mb-1.5">
          Bridge URL <span className="font-normal text-slate-400">(URL ของ Mac ในร้าน)</span>
        </label>
        <input value={values.bridge_url || ''} onChange={e => onChange({ bridge_url: e.target.value })}
          className="field w-full font-mono text-xs" placeholder="http://192.168.2.xxx:3000" />
        <p className="text-[10px] text-slate-400 mt-1">
          เปิด Terminal บน Mac แล้วพิมพ์ <code className="bg-slate-100 px-1 rounded">ipconfig getifaddr en0</code> เพื่อดู IP
        </p>
      </div>
      <div className="border-t border-slate-100 bg-emerald-50 rounded-xl px-3 py-2">
        <p className="text-[11px] text-emerald-700 font-semibold">✅ วิธีพิมพ์ผ่าน WiFi</p>
        <p className="text-[10px] text-emerald-600 mt-0.5">1) เปิดแอป Mac ในร้านไว้ (npm run dev)  2) กรอก IP เครื่องพิมพ์  3) กรอก Bridge URL = IP ของ Mac</p>
      </div>
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-3">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden fade-in">
        <div className="bg-brand text-white px-4 py-3.5 flex justify-between items-center">
          <h2 className="font-heading font-bold">{title}</h2>
          <button onClick={onClose} className="text-2xl opacity-70 leading-none">×</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

function ModalActions({ onCancel, onSave, saving }) {
  return (
    <div className="flex gap-2 pt-1">
      <button onClick={onCancel} className="flex-1 btn-secondary">ยกเลิก</button>
      <button onClick={onSave} disabled={saving} className="flex-1 btn-primary">
        {saving ? 'บันทึก...' : '💾 บันทึก'}
      </button>
    </div>
  )
}

function TelegramWebhookSetup() {
  const [status, setStatus] = useState(null) // null | 'loading' | 'ok' | 'error'
  const [msg, setMsg] = useState('')

  async function reregister() {
    setStatus('loading'); setMsg('')
    try {
      const res = await fetch('/api/telegram-setup')
      const json = await res.json()
      if (json.ok) { setStatus('ok'); setMsg(json.webhook) }
      else { setStatus('error'); setMsg(json.error || 'ไม่สำเร็จ') }
    } catch (e) { setStatus('error'); setMsg(e.message) }
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
      <p className="font-bold text-sm text-blue-800">🤖 Telegram Webhook</p>
      <p className="text-xs text-blue-700">กดเพื่อลงทะเบียน webhook ให้ Telegram ส่งข้อความมาที่ระบบนี้ (ต้องทำก่อนแจ้งเตือนจะทำงาน)</p>
      <button onClick={reregister} disabled={status === 'loading'}
        className="btn-secondary text-xs px-3 py-2 disabled:opacity-40">
        {status === 'loading' ? '⏳ กำลังลงทะเบียน...' : '🔗 ลงทะเบียน Telegram Webhook'}
      </button>
      {status === 'ok' && <p className="text-xs text-emerald-700 font-semibold">✅ สำเร็จ: {msg}</p>}
      {status === 'error' && <p className="text-xs text-red-600 font-semibold">❌ {msg}</p>}
    </div>
  )
}
