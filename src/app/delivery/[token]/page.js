'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function fmt(n) { return Number(n||0).toLocaleString('th-TH') }
function fmtDT(s) {
  if (!s) return ''
  return new Date(s).toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
}
function parseCoords(input) {
  const s = (input||'').trim()
  const atM = s.match(/@(-?\d+\.?\d+),(-?\d+\.?\d+)/)
  if (atM) return { lat: parseFloat(atM[1]), lng: parseFloat(atM[2]) }
  try {
    const url = new URL(s)
    for (const key of ['destination','q','ll','query']) {
      const v = url.searchParams.get(key)
      if (v) { const p = v.split(','); if (p.length>=2 && !isNaN(p[0]) && !isNaN(p[1])) return { lat:parseFloat(p[0]), lng:parseFloat(p[1]) } }
    }
  } catch {}
  const plain = s.match(/^(-?\d+\.?\d+)[,\s]+(-?\d+\.?\d+)$/)
  if (plain) return { lat:parseFloat(plain[1]), lng:parseFloat(plain[2]) }
  return null
}

export default function DeliveryPage({ params }) {
  const { token } = params
  const [doc, setDoc]           = useState(null)
  const [error, setError]       = useState(null)
  const [trips, setTrips]       = useState([])
  const [allDone, setAllDone]   = useState(false)

  // พิกัด
  const [editCoords, setEditCoords] = useState(false)
  const [coordInput, setCoordInput] = useState('')
  const [coordSaving, setCoordSaving] = useState(false)
  const [coordErr, setCoordErr] = useState('')

  // ส่งรอบนี้
  const [tripQty, setTripQty] = useState({})
  const [photo, setPhoto]     = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Live tracking
  const [tracking, setTracking]   = useState(false)
  const [trackErr, setTrackErr]   = useState('')
  const trackTimer = useRef(null)
  const realtimeCh = useRef(null)

  // Signature
  const canvasRef  = useRef(null)
  const canvasRef2 = useRef(null)
  const drawing    = useRef(false)
  const lastPos    = useRef(null)
  const activeCanvas = useRef(null)

  async function load() {
    try {
      const d = await fetch(`/api/delivery?token=${token}`).then(r => r.json())
      if (d.error) { setError(d.error); return }
      setDoc(d)
      setTrips(d.delivery_trips || [])
      if (d.status === 'delivered') setAllDone(true)
      const init = {}
      ;(d.items||[]).forEach((item, i) => {
        const rem = Math.max(0, Number(item.qty||1) - Number(item.delivered_qty||0))
        if (rem > 0) init[i] = rem
      })
      setTripQty(init)
    } catch { setError('โหลดข้อมูลไม่สำเร็จ') }
  }
  useEffect(() => { load() }, [token])

  // ── TRACKING ────────────────────────────────────────────────
  function broadcastLocation(lat, lng) {
    // Supabase Realtime broadcast
    if (realtimeCh.current) {
      realtimeCh.current.send({ type:'broadcast', event:'location', payload:{ lat, lng, ts: Date.now() } })
    }
    // บันทึกลง DB
    fetch('/api/delivery/location', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token, lat, lng })
    }).catch(() => {})
  }

  function getGPS() {
    navigator.geolocation.getCurrentPosition(
      pos => broadcastLocation(pos.coords.latitude, pos.coords.longitude),
      err => setTrackErr('GPS: ' + err.message),
      { timeout:10000, enableHighAccuracy:true }
    )
  }

  function startTracking() {
    if (!navigator.geolocation) { setTrackErr('เบราว์เซอร์ไม่รองรับ GPS'); return }
    setTrackErr('')
    // เปิด Realtime channel
    const ch = sb.channel(`delivery-location-${token}`)
    ch.subscribe()
    realtimeCh.current = ch
    // ส่งทันที
    getGPS()
    // ส่งทุก 30 วิ
    trackTimer.current = setInterval(getGPS, 30000)
    setTracking(true)
  }

  function stopTracking() {
    if (trackTimer.current) { clearInterval(trackTimer.current); trackTimer.current = null }
    if (realtimeCh.current) { sb.removeChannel(realtimeCh.current); realtimeCh.current = null }
    setTracking(false)
  }

  useEffect(() => () => stopTracking(), [])

  // ── COORDS ──────────────────────────────────────────────────
  async function saveCoords() {
    setCoordErr('')
    const parsed = parseCoords(coordInput)
    if (!parsed) { setCoordErr('วาง Google Maps URL หรือพิมพ์ "lat, lng"'); return }
    setCoordSaving(true)
    try {
      const res = await fetch('/api/delivery', { method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token, lat:parsed.lat, lng:parsed.lng }) })
      if (!res.ok) throw new Error((await res.json()).error)
      setDoc(p => ({ ...p, customer_lat:parsed.lat, customer_lng:parsed.lng }))
      setEditCoords(false); setCoordInput('')
    } catch(e) { setCoordErr(e.message) }
    finally { setCoordSaving(false) }
  }
  async function gpsCoords() {
    setCoordErr('')
    if (!navigator.geolocation) { setCoordErr('เบราว์เซอร์ไม่รองรับ GPS'); return }
    setCoordSaving(true)
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude:lat, longitude:lng } = pos.coords
        try {
          await fetch('/api/delivery', { method:'PUT', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ token, lat, lng }) })
          setDoc(p => ({ ...p, customer_lat:lat, customer_lng:lng }))
          setEditCoords(false); setCoordInput('')
        } catch {}
        setCoordSaving(false)
      },
      err => { setCoordErr('GPS: ' + err.message); setCoordSaving(false) },
      { timeout:10000, enableHighAccuracy:true }
    )
  }

  // ── CANVAS ──────────────────────────────────────────────────
  function getPos(e, canvas) {
    const r = canvas.getBoundingClientRect(), s = e.touches ? e.touches[0] : e
    return { x:(s.clientX-r.left)*(canvas.width/r.width), y:(s.clientY-r.top)*(canvas.height/r.height) }
  }
  function startDraw(e, ref) { e.preventDefault(); activeCanvas.current=ref.current; drawing.current=true; lastPos.current=getPos(e,ref.current) }
  function draw(e) {
    e.preventDefault()
    if (!drawing.current||!activeCanvas.current) return
    const c=activeCanvas.current, ctx=c.getContext('2d'), p=getPos(e,c)
    ctx.beginPath(); ctx.moveTo(lastPos.current.x,lastPos.current.y); ctx.lineTo(p.x,p.y)
    ctx.strokeStyle='#1e293b'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.stroke()
    lastPos.current=p
  }
  function endDraw(e) { e.preventDefault(); drawing.current=false }
  function clearSig(ref) { ref.current.getContext('2d').clearRect(0,0,ref.current.width,ref.current.height) }
  function isBlank(canvas) { const b=document.createElement('canvas'); b.width=canvas.width; b.height=canvas.height; return canvas.toDataURL()===b.toDataURL() }

  function onPhotoChange(e) { const f=e.target.files?.[0]; if(!f) return; setPhoto(f); setPhotoPreview(URL.createObjectURL(f)) }

  async function uploadFile(file, path) {
    const { data, error } = await sb.storage.from('delivery-proofs').upload(path, file, { upsert:true })
    if (error) throw new Error('upload ไม่สำเร็จ: ' + error.message)
    return sb.storage.from('delivery-proofs').getPublicUrl(data.path).data.publicUrl
  }

  async function handleSubmit() {
    const delivering = Object.entries(tripQty).filter(([,q]) => q > 0)
    if (delivering.length === 0) { alert('เลือกรายการและจำนวนที่จะส่ง'); return }
    if (isBlank(canvasRef.current)) { alert('กรุณาเซ็นชื่อผู้ส่ง'); return }
    if (isBlank(canvasRef2.current)) { alert('กรุณาเซ็นชื่อลูกค้า'); return }
    setSubmitting(true)
    try {
      let photo_url=null, sig_url=null, cust_sig_url=null
      if (photo) photo_url = await uploadFile(photo, `${token}/photo_${Date.now()}.jpg`)
      await new Promise((res,rej) => canvasRef.current.toBlob(async b => { try{sig_url=await uploadFile(b,`${token}/sig_staff_${Date.now()}.png`);res()}catch(e){rej(e)} },'image/png'))
      await new Promise((res,rej) => canvasRef2.current.toBlob(async b => { try{cust_sig_url=await uploadFile(b,`${token}/sig_cust_${Date.now()}.png`);res()}catch(e){rej(e)} },'image/png'))
      const items_delivered = delivering.map(([idx, qty]) => ({
        idx: Number(idx), name:(doc.items||[])[Number(idx)]?.name||'', qty_delivered:qty
      }))
      const resp = await fetch('/api/delivery', {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token, items_delivered, photo_url, signature_url:sig_url, customer_signature_url:cust_sig_url })
      })
      const result = await resp.json()
      if (!resp.ok) throw new Error(result.error)
      stopTracking()
      if (result.all_done) setAllDone(true)
      else await load()
    } catch(e) { alert('เกิดข้อผิดพลาด: ' + e.message) }
    finally { setSubmitting(false) }
  }

  // ── RENDER GUARDS ───────────────────────────────────────────
  if (error) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
      <div><div className="text-5xl mb-4">❌</div><p className="text-slate-600 mb-4">{error}</p>
      <a href="/delivery" className="text-sm text-blue-500">← กลับรายการ</a></div>
    </div>
  )
  if (!doc) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="text-slate-400 text-sm">กำลังโหลด...</div></div>

  const mapsUrl = (doc.customer_lat && doc.customer_lng)
    ? `https://www.google.com/maps/dir/?api=1&destination=${doc.customer_lat},${doc.customer_lng}`
    : doc.customer_address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(doc.customer_address)}` : null

  const trackUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/delivery/track/${token}`

  // ── DONE SCREEN ─────────────────────────────────────────────
  if (allDone) return (
    <div className="min-h-screen bg-slate-50 pb-8" style={{fontFamily:'system-ui,sans-serif'}}>
      <div style={{background:'#C72C41'}} className="text-white px-4 pt-10 pb-6 text-center">
        <div className="text-5xl mb-2">✅</div>
        <h2 className="text-xl font-bold">ส่งของเรียบร้อยแล้ว</h2>
        <p className="text-sm opacity-80 mt-1">{doc.doc_no} · {doc.customer_name}</p>
      </div>
      <div className="px-4 py-4 space-y-3 max-w-lg mx-auto">
        {trips.map((t, i) => (
          <div key={t.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <p className="text-sm font-bold text-slate-600">รอบที่ {i+1} — {fmtDT(t.delivered_at)}</p>
            </div>
            <div className="px-4 py-3 space-y-1">
              {(t.items_delivered||[]).map((d,j) => (
                <p key={j} className="text-sm text-slate-600">• {d.name} <span className="font-semibold">x{d.qty_delivered}</span></p>
              ))}
            </div>
            {(t.photo_url || t.signature_url || t.customer_signature_url) && (
              <div className="px-4 pb-4 space-y-3 border-t border-slate-50 pt-3">
                {t.photo_url && (
                  <div>
                    <p className="text-xs text-slate-400 mb-1">รูปหลักฐาน</p>
                    <img src={t.photo_url} alt="หลักฐาน" className="w-full rounded-lg object-cover max-h-52" />
                  </div>
                )}
                {t.signature_url && (
                  <div>
                    <p className="text-xs text-slate-400 mb-1">ลายเซ็นผู้ส่ง</p>
                    <img src={t.signature_url} alt="ลายเซ็นผู้ส่ง" className="w-full rounded border border-slate-100" />
                  </div>
                )}
                {t.customer_signature_url && (
                  <div>
                    <p className="text-xs text-slate-400 mb-1">ลายเซ็นลูกค้า</p>
                    <img src={t.customer_signature_url} alt="ลายเซ็นลูกค้า" className="w-full rounded border border-slate-100" />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <button onClick={() => { window.location.href='/delivery' }}
          className="w-full py-3 rounded-xl font-bold text-white text-sm mt-2"
          style={{background:'#C72C41'}}>← กลับรายการส่งของ</button>
      </div>
    </div>
  )

  const items    = doc.items || []
  const remaining = items.filter(item => Number(item.delivered_qty||0) < Number(item.qty||1))
  const hasSelected = Object.values(tripQty).some(q => q > 0)

  return (
    <div className="min-h-screen bg-slate-50 pb-28" style={{fontFamily:'system-ui,sans-serif'}}>
      {/* Header */}
      <div style={{background:'#C72C41'}} className="text-white px-4 pt-10 pb-4">
        <button onClick={() => window.location.href='/delivery'} className="text-xs opacity-75 mb-2 block">← รายการส่งของ</button>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">{doc.doc_no}</h1>
            <p className="text-sm opacity-90">{doc.customer_name}</p>
            {doc.customer_phone && <p className="text-xs opacity-75">{doc.customer_phone}</p>}
          </div>
          {/* Live tracking toggle */}
          <div className="flex flex-col items-end gap-1.5">
            <button onClick={tracking ? stopTracking : startTracking}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors"
              style={{background: tracking ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.2)', color: tracking ? '#C72C41' : 'white'}}>
              {tracking
                ? <><span className="w-2 h-2 bg-red-500 rounded-full animate-pulse inline-block" /> หยุดติดตาม</>
                : <>📡 เริ่มติดตาม</>
              }
            </button>
            {tracking && (
              <a href={trackUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs underline opacity-80">🔗 แชร์ link ติดตาม</a>
            )}
            {trackErr && <p className="text-xs text-yellow-200">{trackErr}</p>}
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* ที่อยู่ + พิกัด */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-400">ที่อยู่จัดส่ง</p>
            <button onClick={() => { setEditCoords(true); setCoordInput(''); setCoordErr('') }}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg border"
              style={{color:'#C72C41', borderColor:'#C72C41'}}>
              📍 {doc.customer_lat ? 'แก้พิกัด' : 'เพิ่มพิกัด'}
            </button>
          </div>
          {doc.customer_address && <p className="text-sm text-slate-700 mb-2">{doc.customer_address}</p>}
          {doc.customer_lat && doc.customer_lng && (
            <p className="text-xs text-slate-400 mb-2">📌 {Number(doc.customer_lat).toFixed(6)}, {Number(doc.customer_lng).toFixed(6)}</p>
          )}
          {mapsUrl
            ? <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{background:'#1a73e8'}}>🗺️ เปิด Google Maps นำทาง</a>
            : <p className="text-xs text-slate-400">ไม่มีพิกัด GPS</p>
          }
        </div>

        {/* Modal แก้พิกัด */}
        {editCoords && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={e => e.target===e.currentTarget&&setEditCoords(false)}>
            <div className="bg-white w-full rounded-t-2xl p-5 space-y-3">
              <h3 className="font-bold text-slate-700">📍 แก้ไขพิกัด</h3>
              <textarea value={coordInput} onChange={e => setCoordInput(e.target.value)} rows={3}
                placeholder="วาง Google Maps URL หรือพิมพ์ lat, lng เช่น 15.1234, 102.5678"
                className="w-full border border-slate-200 rounded-xl p-3 text-sm resize-none outline-none focus:border-red-400" />
              {coordErr && <p className="text-xs text-red-500">{coordErr}</p>}
              <div className="flex gap-2">
                <button onClick={gpsCoords} disabled={coordSaving}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-slate-300 text-slate-600 disabled:opacity-40">
                  {coordSaving ? '⏳' : '📍 ใช้ GPS ของฉัน'}
                </button>
                <button onClick={saveCoords} disabled={coordSaving||!coordInput.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
                  style={{background:'#C72C41'}}>บันทึก</button>
              </div>
              <button onClick={() => setEditCoords(false)} className="w-full text-sm text-slate-400 py-1">ยกเลิก</button>
            </div>
          </div>
        )}

        {/* ประวัติการส่ง */}
        {trips.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-700">📋 ประวัติการส่ง {trips.length} รอบ</p>
            </div>
            {trips.map((t, i) => (
              <div key={t.id} className="px-4 py-3 border-b border-slate-50">
                <p className="text-xs font-bold text-slate-500 mb-1">รอบที่ {i+1} — {fmtDT(t.delivered_at)}</p>
                {(t.items_delivered||[]).map((d,j) => (
                  <p key={j} className="text-xs text-slate-600 ml-2">• {d.name} <span className="font-semibold">x{d.qty_delivered}</span></p>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* รายการสินค้า */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">รายการที่ต้องส่ง</p>
            <span className="text-xs text-slate-400">{remaining.length} รายการค้าง</span>
          </div>
          {items.map((item, i) => {
            const total = Number(item.qty||1), sent = Number(item.delivered_qty||0)
            const remain = Math.max(0, total - sent), isFullSent = remain === 0
            const qty2send = tripQty[i] ?? 0
            return (
              <div key={i} className={`px-4 py-3 border-b border-slate-50 ${isFullSent ? 'opacity-50' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${isFullSent ? 'line-through text-slate-400' : 'text-slate-700'}`}>{item.name||item.product_name}</p>
                    {item.sku && <p className="text-xs text-slate-400">{item.sku}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      {sent > 0 && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">ส่งแล้ว {sent}</span>}
                      {!isFullSent && <span className="text-xs text-slate-400">ค้าง {remain}</span>}
                      {isFullSent && <span className="text-xs text-green-600 font-semibold">✅ ครบ</span>}
                    </div>
                  </div>
                  {!isFullSent && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <p className="text-xs text-slate-400">รอบนี้</p>
                      <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                        <button onClick={() => setTripQty(p => ({...p,[i]:Math.max(0,(p[i]||0)-1)}))}
                          className="px-2.5 py-1.5 text-slate-500 text-sm font-bold active:bg-slate-100">−</button>
                        <span className="w-8 text-center text-sm font-bold text-slate-700">{qty2send}</span>
                        <button onClick={() => setTripQty(p => ({...p,[i]:Math.min(remain,(p[i]||0)+1)}))}
                          className="px-2.5 py-1.5 text-sm font-bold active:bg-slate-100" style={{color:'#C72C41'}}>+</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          <div className="px-4 py-3 space-y-1">
            {Number(doc.discount||0)>0 && <div className="flex justify-between text-sm text-slate-500"><span>ส่วนลด</span><span>-฿{fmt(doc.discount)}</span></div>}
            {Number(doc.delivery_fee||0)>0 && <div className="flex justify-between text-sm text-slate-500"><span>ค่าจัดส่ง</span><span>฿{fmt(doc.delivery_fee)}</span></div>}
            <div className="flex justify-between text-base font-bold text-slate-800 pt-1 border-t border-slate-100">
              <span>รวม</span><span style={{color:'#C72C41'}}>฿{fmt(doc.total)}</span>
            </div>
          </div>
        </div>

        {doc.note && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-amber-700 mb-1">หมายเหตุ</p>
            <p className="text-sm text-amber-800">{doc.note}</p>
          </div>
        )}

        {/* ถ่ายรูป */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3">📷 รูปหลักฐาน <span className="text-slate-400 font-normal text-xs">(ไม่บังคับ)</span></p>
          {photoPreview
            ? <div className="relative">
                <img src={photoPreview} alt="รูปหลักฐาน" className="w-full rounded-lg object-cover max-h-64" />
                <button onClick={()=>{setPhoto(null);setPhotoPreview(null)}}
                  className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs">✕</button>
              </div>
            : <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl py-8 cursor-pointer active:bg-slate-50">
                <span className="text-3xl mb-2">📸</span>
                <span className="text-sm text-slate-400">แตะเพื่อถ่ายรูป / เลือกรูป</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoChange} />
              </label>
          }
        </div>

        {/* ลายเซ็น */}
        {[['✍️ ลายเซ็นผู้ส่ง', canvasRef, 'ลายเซ็นผู้จัดส่ง'], ['✍️ ลายเซ็นผู้รับ (ลูกค้า)', canvasRef2, 'ลายเซ็นลูกค้า']].map(([label, ref, sub]) => (
          <div key={label} className="bg-white rounded-xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">{label}</p>
              <button onClick={() => clearSig(ref)} className="text-xs text-slate-400 border border-slate-200 rounded px-2 py-1">ล้าง</button>
            </div>
            <canvas ref={ref} width={600} height={180}
              className="w-full border-2 border-slate-200 rounded-xl bg-slate-50 touch-none" style={{touchAction:'none'}}
              onMouseDown={e=>startDraw(e,ref)} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
              onTouchStart={e=>startDraw(e,ref)} onTouchMove={draw} onTouchEnd={endDraw} />
            <p className="text-xs text-slate-400 text-center mt-1.5">{sub}</p>
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-100 shadow-lg">
        {!hasSelected && <p className="text-xs text-slate-400 text-center mb-2">เพิ่มจำนวนที่จะส่งรอบนี้ก่อน</p>}
        <button onClick={handleSubmit} disabled={submitting||!hasSelected}
          className="w-full py-4 rounded-xl text-white font-bold text-base disabled:opacity-40"
          style={{background: submitting ? '#aaa' : '#C72C41'}}>
          {submitting ? '⏳ กำลังบันทึก...' : `📦 ยืนยันส่งของรอบนี้ (${Object.values(tripQty).filter(q=>q>0).length} รายการ)`}
        </button>
      </div>
    </div>
  )
}
