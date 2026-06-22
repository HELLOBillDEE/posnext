'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, fmtDate } from '@/lib/utils'

const SETTING_FIELDS = [
  { key:'shop_name',       label:'ชื่อร้าน',                         placeholder:'ร้านของฉัน' },
  { key:'shop_address',    label:'ที่อยู่ร้าน',                       placeholder:'เลขที่ ถนน อำเภอ จังหวัด' },
  { key:'shop_tax_id',     label:'เลขประจำตัวผู้เสียภาษี',           placeholder:'0-0000-00000-00-0' },
  { key:'shop_phone',      label:'เบอร์โทรศัพท์',                    placeholder:'080-000-0000' },
  { key:'owner_name',      label:'ชื่อผู้ประกอบกิจการ (สำหรับภาษี)', placeholder:'นาย/นาง/นางสาว ชื่อ นามสกุล' },
  { key:'owner_id',        label:'เลขประจำตัวประชาชน (13 หลัก)',     placeholder:'1100000000000' },
  { key:'vat_rate',        label:'อัตรา VAT (%)',                     placeholder:'7 หรือ 0 (ถ้าไม่คิด VAT)' },
  { key:'ot_rate',         label:'อัตรา OT/ชม. (บาท)',               placeholder:'75' },
  { key:'receipt_footer',  label:'ข้อความท้ายใบเสร็จ',               placeholder:'ขอบคุณที่ใช้บริการ' },
]

const TABS = ['ตั้งค่าร้าน', 'เครื่องพิมพ์', 'ลูกค้า', 'ซัพพลายเออร์', 'ประวัติสต็อก', '🔗 BillDEE Sync']

const DEF_BILLDEE = { url: '', business_id: '', token: '', enabled: false }
function loadBillDeeConfig() {
  if (typeof window === 'undefined') return DEF_BILLDEE
  return JSON.parse(localStorage.getItem('billdee_config') || 'null') || DEF_BILLDEE
}

const DEF_BARCODE  = { name:'Barcode Printer', ip:'', port:'9100', paper_width:'100', bridge_url:'', lang:'tspl' }
const DEF_RECEIPT  = { name:'Receipt Printer', ip:'', port:'9100', paper_width:'80',  bridge_url:'' }

function loadPrinters() {
  if (typeof window === 'undefined') return { barcode: DEF_BARCODE, receipt: DEF_RECEIPT }
  return {
    barcode: JSON.parse(localStorage.getItem('printer_barcode') || 'null') || DEF_BARCODE,
    receipt: JSON.parse(localStorage.getItem('printer_receipt') || 'null') || DEF_RECEIPT,
  }
}

export default function AdminPage() {
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
  const [logoUploading, setLogoUploading] = useState(false)

  useEffect(() => { loadAll() }, [tab])

  async function loadAll() {
    const { data: cfg } = await supabase.from('settings').select('*')
    if (cfg) setSettings(Object.fromEntries(cfg.map(r => [r.key, r.value])))
    if (tab === 2) {
      const { data } = await supabase.from('customers').select('*').order('name')
      setCustomers(data || [])
    }
    if (tab === 3) {
      const { data } = await supabase.from('suppliers').select('*').order('name')
      setSuppliers(data || [])
    }
    if (tab === 4) {
      const { data } = await supabase.from('stock_history').select('*, products(name)').order('created_at', { ascending: false }).limit(100)
      setStockHist(data || [])
    }
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

  function savePrinters() {
    localStorage.setItem('printer_barcode', JSON.stringify(printers.barcode))
    localStorage.setItem('printer_receipt', JSON.stringify(printers.receipt))
    setPrinterSaved(true)
    setTimeout(() => setPrinterSaved(false), 2000)
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
    try {
      if (suppModal === 'add') await supabase.from('suppliers').insert(suppForm)
      else await supabase.from('suppliers').update(suppForm).eq('id', suppModal.id)
      setSuppModal(null)
      const { data } = await supabase.from('suppliers').select('*').order('name')
      setSuppliers(data || [])
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  const filteredCust = customers.filter(c => !search || c.name.includes(search) || (c.phone||'').includes(search))
  const filteredSupp = suppliers.filter(s => !search || s.name.includes(search) || (s.phone||'').includes(search))

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

          {SETTING_FIELDS.map(f => (
            <div key={f.key}>
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">{f.label}</label>
              <input value={settings[f.key] || ''} onChange={e => setSettings(p => ({...p, [f.key]: e.target.value}))}
                placeholder={f.placeholder} className="field w-full" />
            </div>
          ))}
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
              <div>
                <h2 className="font-heading font-semibold text-slate-800">เครื่องปริ้นสติ๊กเกอร์บาร์โค้ด</h2>
                <p className="text-xs text-slate-400">เชื่อมต่อผ่าน WiFi / IP</p>
              </div>
            </div>
            <PrinterFields
              values={printers.barcode}
              onChange={v => setPrinters(p => ({...p, barcode: {...p.barcode, ...v}}))}
              paperOptions={[{v:'100',l:'100mm (3 ดวง/แถว)'},{v:'58',l:'58mm (มาตรฐาน)'},{v:'40',l:'40mm (แคบ)'}]}
            />
          </div>

          {/* Receipt printer */}
          <div className="card-pad space-y-4">
            <div className="flex items-center gap-3 pb-2 border-b border-slate-100">
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-xl">🧾</div>
              <div>
                <h2 className="font-heading font-semibold text-slate-800">เครื่องปริ้นใบเสร็จ</h2>
                <p className="text-xs text-slate-400">เชื่อมต่อผ่าน WiFi / IP</p>
              </div>
            </div>
            <PrinterFields
              values={printers.receipt}
              onChange={v => setPrinters(p => ({...p, receipt: {...p.receipt, ...v}}))}
              paperOptions={[{v:'80',l:'80mm (มาตรฐาน)'},{v:'58',l:'58mm (แคบ)'}]}
            />
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-sm text-blue-700 space-y-1.5">
            <p className="font-semibold">📌 วิธีตั้งค่า Print Bridge</p>
            <p>1. ติดตั้ง <strong>Node.js</strong> (nodejs.org) ที่คอมในร้าน</p>
            <p>2. ดับเบิลคลิก <code className="bg-blue-100 px-1 rounded text-xs">start.bat</code> ใน folder print-bridge</p>
            <p>3. จะขึ้น Bridge URL เช่น <strong>https://192.168.x.x:9001</strong></p>
            <p>4. เปิด URL นั้นบน iPad → กด <strong>ดาวน์โหลด Certificate</strong> → ไปติดตั้งใน Settings</p>
            <p>5. ใส่ Bridge URL และ IP เครื่องพิมพ์ด้านบน แล้วกดบันทึก</p>
            <p className="text-blue-500 text-xs">ℹ️ ถ้า HTTPS ไม่ผ่าน ใส่ http://[IP]:9000 แทน (ก่อนติดตั้ง cert)</p>
          </div>

          <button onClick={savePrinters}
            className={`w-full py-3.5 rounded-xl text-sm font-bold transition-all shadow active:scale-95
              ${printerSaved ? 'bg-emerald-600 text-white' : 'btn-primary'}`}>
            {printerSaved ? '✓ บันทึกแล้ว' : '💾 บันทึกการตั้งค่าเครื่องพิมพ์'}
          </button>
        </div>
      )}

      {/* ── Customers ── */}
      {tab === 2 && (
        <div>
          <div className="flex gap-2 mb-3">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาลูกค้า"
              className="field flex-1" />
            <button onClick={() => { setCustForm({ code:'', name:'', phone:'', address:'', tax_id:'', credit_limit:'0' }); setCustModal('add') }}
              className="btn-primary shrink-0">+ เพิ่มลูกค้า</button>
          </div>
          <div className="card overflow-hidden">
            <div className="divide-y divide-slate-50">
              {filteredCust.map(c => (
                <div key={c.id} className="px-4 py-3 flex justify-between items-center hover:bg-slate-50">
                  <div>
                    <p className="font-semibold text-sm text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.phone || '—'} · เครดิต ฿{fmt(c.credit_limit)}</p>
                  </div>
                  <button onClick={() => { setCustForm({ ...c, credit_limit: String(c.credit_limit||0) }); setCustModal({ id: c.id }) }}
                    className="text-xs text-brand border border-brand/30 px-3 py-1.5 rounded-lg active:bg-brand/5">แก้ไข</button>
                </div>
              ))}
              {filteredCust.length === 0 && <div className="text-center py-10 text-slate-400 text-sm">ไม่พบลูกค้า</div>}
            </div>
          </div>
        </div>
      )}

      {/* ── Suppliers ── */}
      {tab === 3 && (
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
      {tab === 4 && (
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

      {/* ── BillDEE Sync ── */}
      {tab === 5 && (
        <div className="space-y-5 max-w-xl">
          <div className="card-pad space-y-4">
            <div className="flex items-center gap-3 pb-2 border-b border-slate-100">
              <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center text-xl">🔗</div>
              <div>
                <h2 className="font-heading font-semibold text-slate-800">เชื่อมต่อกับ BillDEE</h2>
                <p className="text-xs text-slate-400">ยอดขาย POS จะส่งเป็นรายรับใน BillDEE อัตโนมัติ</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50">
              <span className="text-sm font-semibold text-slate-700">เปิดใช้งาน Auto Sync</span>
              <button onClick={() => setBilldee(p => ({ ...p, enabled: !p.enabled }))}
                className={`relative w-12 h-6 rounded-full transition-colors ${billdee.enabled ? 'bg-teal-500' : 'bg-slate-300'}`}>
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${billdee.enabled ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">BillDEE App URL</label>
              <input value={billdee.url} onChange={e => setBilldee(p => ({ ...p, url: e.target.value }))}
                className="field w-full font-mono text-sm" placeholder="https://billdeeline-xxx.vercel.app" />
              <p className="text-[10px] text-slate-400 mt-1">URL ของแอป BillDEE ที่ Deploy บน Vercel</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">Business ID (UUID)</label>
              <input value={billdee.business_id} onChange={e => setBilldee(p => ({ ...p, business_id: e.target.value }))}
                className="field w-full font-mono text-sm" placeholder="xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx" />
              <p className="text-[10px] text-slate-400 mt-1">ดูได้จาก BillDEE → ตั้งค่า → ข้อมูลบัญชี (Business ID)</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">POS Sync Token</label>
              <input value={billdee.token} onChange={e => setBilldee(p => ({ ...p, token: e.target.value }))}
                className="field w-full font-mono text-sm" type="password" placeholder="ใส่ค่าเดียวกับ POS_SYNC_TOKEN ใน Vercel" />
              <p className="text-[10px] text-slate-400 mt-1">ตั้งค่า POS_SYNC_TOKEN ใน Vercel Environment Variables ของ BillDEE</p>
            </div>

            {billdeeStatus === 'ok' && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-semibold">
                ✅ เชื่อมต่อสำเร็จ! BillDEE รับ Sync ได้แล้ว
              </div>
            )}
            {billdeeStatus === 'error' && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
                ❌ เชื่อมต่อไม่ได้ — ตรวจสอบ URL, Business ID และ Token อีกครั้ง
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={testBillDeeSync} disabled={billdeeStatus === 'testing'}
                className="flex-1 py-3 rounded-xl border-2 border-teal-500 text-teal-600 text-sm font-bold active:bg-teal-50 disabled:opacity-50">
                {billdeeStatus === 'testing' ? '⏳ กำลังทดสอบ...' : '🧪 ทดสอบการเชื่อมต่อ'}
              </button>
              <button onClick={saveBillDee} className="flex-1 py-3 rounded-xl btn-primary text-sm font-bold">
                💾 บันทึก
              </button>
            </div>
          </div>

          <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4 text-sm text-teal-800 space-y-2">
            <p className="font-semibold">📋 วิธีตั้งค่า</p>
            <p>1. เข้า <strong>Vercel</strong> → Project BillDEE → Settings → Environment Variables</p>
            <p>2. เพิ่ม <code className="bg-teal-100 px-1 rounded text-xs">POS_SYNC_TOKEN</code> = ตัวเลขสุ่มที่คุณกำหนดเอง</p>
            <p>3. กลับมาใส่ค่าเดียวกันในช่อง "POS Sync Token" ด้านบน</p>
            <p>4. Business ID หาได้จาก BillDEE: เปิดแอป → กด ⚙️ ตั้งค่า → คัดลอก Business ID</p>
            <p>5. กด "ทดสอบการเชื่อมต่อ" → ถ้าขึ้น ✅ ก็พร้อมใช้งาน</p>
          </div>
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

function PrinterFields({ values, onChange, paperOptions }) {
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
      {/* Print Bridge URL */}
      <div className="pt-1 border-t border-slate-100">
        <label className="text-xs font-semibold text-slate-500 block mb-1.5">
          Print Bridge URL
          <span className="ml-1.5 font-normal text-slate-400">(สำหรับพิมพ์ตรง IP ไม่ผ่าน dialog)</span>
        </label>
        <input value={values.bridge_url || ''} onChange={e => onChange({ bridge_url: e.target.value })}
          className="field w-full font-mono text-xs" placeholder="http://192.168.2.100:9001" />
        <p className="text-[10px] text-slate-400 mt-1">รัน bridge.js ที่คอมในร้าน แล้วใส่ IP คอม:9001 ที่นี่</p>
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
