'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseStorage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function fmt(n) { return Number(n||0).toLocaleString('th-TH') }

export default function DeliveryPage({ params }) {
  const { token } = params
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState(null)
  const [checked, setChecked] = useState({})
  const [done, setDone] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const lastPos = useRef(null)

  useEffect(() => {
    fetch(`/api/delivery?token=${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else {
          setDoc(d)
          setChecked(Object.fromEntries((d.items||[]).map((_,i)=>[i,false])))
          if (d.delivered_at) setDone(true)
        }
      })
      .catch(() => setError('โหลดข้อมูลไม่สำเร็จ'))
  }, [token])

  // Google Maps URL — ใช้ lat/lng ถ้ามี ไม่งั้นใช้ address search
  function getMapsUrl(doc) {
    if (doc.customer_lat && doc.customer_lng)
      return `https://www.google.com/maps/dir/?api=1&destination=${doc.customer_lat},${doc.customer_lng}`
    if (doc.customer_address)
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(doc.customer_address)}`
    return null
  }

  // Signature canvas
  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect()
    const src = e.touches ? e.touches[0] : e
    return { x: (src.clientX - rect.left) * (canvas.width / rect.width), y: (src.clientY - rect.top) * (canvas.height / rect.height) }
  }
  function startDraw(e) { e.preventDefault(); drawing.current = true; lastPos.current = getPos(e, canvasRef.current) }
  function draw(e) {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e, canvas)
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y); ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke()
    lastPos.current = pos
  }
  function endDraw(e) { e.preventDefault(); drawing.current = false }
  function clearSig() { canvasRef.current.getContext('2d').clearRect(0, 0, canvasRef.current.width, canvasRef.current.height) }

  function onPhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhoto(file); setPhotoPreview(URL.createObjectURL(file))
  }

  async function uploadFile(file, path) {
    const { data, error } = await supabaseStorage.storage.from('delivery-proofs').upload(path, file, { upsert: true })
    if (error) throw new Error('upload ไม่สำเร็จ: ' + error.message)
    const { data: { publicUrl } } = supabaseStorage.storage.from('delivery-proofs').getPublicUrl(data.path)
    return publicUrl
  }

  async function handleSubmit() {
    const canvas = canvasRef.current
    const blank = document.createElement('canvas')
    blank.width = canvas.width; blank.height = canvas.height
    if (canvas.toDataURL() === blank.toDataURL()) { alert('กรุณาเซ็นชื่อก่อนยืนยัน'); return }
    setSubmitting(true)
    try {
      let photo_url = null, signature_url = null
      if (photo) photo_url = await uploadFile(photo, `${token}/photo_${Date.now()}.jpg`)
      await new Promise((resolve, reject) => {
        canvas.toBlob(async blob => {
          try { signature_url = await uploadFile(blob, `${token}/signature.png`); resolve() }
          catch(e) { reject(e) }
        }, 'image/png')
      })
      const res = await fetch('/api/delivery', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, photo_url, signature_url }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      setDone(true)
    } catch (e) { alert('เกิดข้อผิดพลาด: ' + e.message) }
    finally { setSubmitting(false) }
  }

  if (error) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="text-5xl mb-4">❌</div>
        <p className="text-slate-600 mb-4">{error}</p>
        <a href="/delivery" className="text-sm text-blue-500">← กลับรายการ</a>
      </div>
    </div>
  )

  if (!doc) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-slate-400 text-sm">กำลังโหลด...</div>
    </div>
  )

  if (done) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="text-6xl mb-4">✅</div>
      <h2 className="text-xl font-bold text-slate-700 mb-1">ส่งของเรียบร้อยแล้ว</h2>
      <p className="text-slate-500 text-sm mb-1">{doc.doc_no} · {doc.customer_name}</p>
      {doc.delivered_at && <p className="text-slate-400 text-xs mb-4">{new Date(doc.delivered_at).toLocaleString('th-TH')}</p>}
      {doc.delivery_signature_url && (
        <div className="bg-white rounded-xl p-3 shadow-sm mb-6 w-full max-w-xs">
          <p className="text-xs text-slate-400 mb-2 text-center">ลายเซ็น</p>
          <img src={doc.delivery_signature_url} alt="ลายเซ็น" className="w-full rounded" />
        </div>
      )}
      {doc.delivery_photo_url && (
        <div className="bg-white rounded-xl p-3 shadow-sm mb-6 w-full max-w-xs">
          <p className="text-xs text-slate-400 mb-2 text-center">รูปหลักฐาน</p>
          <img src={doc.delivery_photo_url} alt="รูปหลักฐาน" className="w-full rounded" />
        </div>
      )}
      <a href="/delivery"
        className="px-6 py-3 rounded-xl font-bold text-white text-sm"
        style={{background:'#C72C41'}}>
        ← กลับรายการส่งของ
      </a>
    </div>
  )

  const items = doc.items || []
  const allChecked = items.length > 0 && items.every((_, i) => checked[i])
  const mapsUrl = getMapsUrl(doc)

  return (
    <div className="min-h-screen bg-slate-50 pb-24" style={{fontFamily:'system-ui,sans-serif'}}>
      {/* Header */}
      <div style={{background:'#C72C41'}} className="text-white px-4 pt-10 pb-4">
        <a href="/delivery" className="text-xs opacity-75 mb-2 block">← รายการส่งของ</a>
        <h1 className="text-lg font-bold">{doc.doc_no}</h1>
        <p className="text-sm opacity-90 mt-0.5">{doc.customer_name}</p>
        {doc.customer_phone && <p className="text-xs opacity-75">{doc.customer_phone}</p>}
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* ที่อยู่ + แผนที่ */}
        {(doc.customer_address || mapsUrl) && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-400 mb-1">ที่อยู่จัดส่ง</p>
            {doc.customer_address && <p className="text-sm text-slate-700 mb-3">{doc.customer_address}</p>}
            {mapsUrl ? (
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
                style={{background:'#1a73e8'}}>
                🗺️ เปิด Google Maps นำทาง
              </a>
            ) : (
              <p className="text-xs text-slate-400">ไม่มีพิกัด GPS</p>
            )}
          </div>
        )}

        {/* รายการของ */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">รายการสินค้า</p>
            <button onClick={() => setChecked(Object.fromEntries(items.map((_,i)=>[i,!allChecked])))}
              className="text-xs font-semibold" style={{color:'#C72C41'}}>
              {allChecked ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
            </button>
          </div>
          {items.map((item, i) => (
            <label key={i} className="flex items-center gap-3 px-4 py-3 border-b border-slate-50 cursor-pointer active:bg-slate-50">
              <input type="checkbox" checked={!!checked[i]} onChange={e => setChecked(p=>({...p,[i]:e.target.checked}))}
                className="w-5 h-5 accent-red-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${checked[i]?'line-through text-slate-400':'text-slate-700'}`}>{item.name||item.product_name}</p>
                {item.sku && <p className="text-xs text-slate-400">{item.sku}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold text-slate-700">x{item.qty||1}</p>
                <p className="text-xs text-slate-400">฿{fmt(item.price)}</p>
              </div>
            </label>
          ))}
          <div className="px-4 py-3 space-y-1">
            {Number(doc.discount||0)>0 && <div className="flex justify-between text-sm text-slate-500"><span>ส่วนลด</span><span>-฿{fmt(doc.discount)}</span></div>}
            {Number(doc.delivery_fee||0)>0 && <div className="flex justify-between text-sm text-slate-500"><span>ค่าจัดส่ง</span><span>฿{fmt(doc.delivery_fee)}</span></div>}
            <div className="flex justify-between text-base font-bold text-slate-800 pt-1 border-t border-slate-100">
              <span>รวมทั้งหมด</span><span style={{color:'#C72C41'}}>฿{fmt(doc.total)}</span>
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
          <p className="text-sm font-semibold text-slate-700 mb-3">📷 ถ่ายรูปหลักฐาน <span className="text-slate-400 font-normal text-xs">(ไม่บังคับ)</span></p>
          {photoPreview ? (
            <div className="relative">
              <img src={photoPreview} alt="รูปหลักฐาน" className="w-full rounded-lg object-cover max-h-64" />
              <button onClick={()=>{setPhoto(null);setPhotoPreview(null)}}
                className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs">✕</button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl py-8 cursor-pointer active:bg-slate-50">
              <span className="text-3xl mb-2">📸</span>
              <span className="text-sm text-slate-400">แตะเพื่อถ่ายรูป / เลือกรูป</span>
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoChange} />
            </label>
          )}
        </div>

        {/* ลายเซ็น */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-700">✍️ ลายเซ็นผู้ส่ง</p>
            <button onClick={clearSig} className="text-xs text-slate-400 border border-slate-200 rounded px-2 py-1">ล้าง</button>
          </div>
          <canvas ref={canvasRef} width={600} height={200}
            className="w-full border-2 border-slate-200 rounded-xl bg-slate-50 touch-none"
            style={{touchAction:'none'}}
            onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
            onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
          />
          <p className="text-xs text-slate-400 text-center mt-2">เซ็นชื่อในกล่องด้านบน</p>
        </div>
      </div>

      {/* ปุ่มยืนยัน */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-100 shadow-lg">
        <button onClick={handleSubmit} disabled={submitting}
          className="w-full py-4 rounded-xl text-white font-bold text-base disabled:opacity-50"
          style={{background: submitting ? '#aaa' : '#C72C41'}}>
          {submitting ? '⏳ กำลังบันทึก...' : '✅ ยืนยันส่งของเรียบร้อย'}
        </button>
      </div>
    </div>
  )
}
