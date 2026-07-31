'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { convertThaiBarcode } from '@/lib/utils'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH')

export default function StockCountPage() {
  const [products, setProducts]   = useState([])
  const [counts, setCounts]       = useState([])
  const [scanInput, setScanInput] = useState('')
  const [nameSearch, setNameSearch] = useState('')
  const [nameSuggestions, setNameSuggestions] = useState([])
  const [lastMsg, setLastMsg]       = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [hasBD, setHasBD]          = useState(false)
  const [camDbg, setCamDbg]         = useState('')
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [applyMode, setApplyMode]   = useState('add') // 'add' | 'reduce' | 'reset'
  const [applyPreview, setApplyPreview] = useState([])
  const [applying, setApplying]     = useState(false)
  const [draftSaved, setDraftSaved] = useState(false)
  const inputRef    = useRef(null)
  const productsRef = useRef([])
  const scannerRef  = useRef(null)
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const rafRef      = useRef(null)

  useEffect(() => { productsRef.current = products }, [products])
  useEffect(() => { setHasBD(typeof window !== 'undefined' && 'BarcodeDetector' in window) }, [])

  useEffect(() => {
    async function loadAll() {
      const all = []
      const PAGE = 1000
      let from = 0
      while (true) {
        const { data } = await supabase.from('products')
          .select('id, name, barcode, alt_barcode, stock, unit, search_tags, categories(name)')
          .range(from, from + PAGE - 1)
        if (!data || data.length === 0) break
        all.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }
      setProducts(all)
    }
    loadAll()
    try {
      const saved = JSON.parse(localStorage.getItem('stock_count_session') || 'null')
      if (saved) setCounts(saved)
    } catch {}
    inputRef.current?.focus()
  }, [])

  const flashMsg = useCallback((text, ok = true) => {
    setLastMsg({ text, ok })
    setTimeout(() => setLastMsg(null), 3000)
  }, [])

  const addProduct = useCallback((prod, qty = 1) => {
    const bc = (prod.barcode || prod.id).toString().toUpperCase()
    flashMsg(`+${qty} ${prod.name}`)
    setCounts(prev => {
      const existing = prev.find(c => c.pid === prod.id)
      const next = existing
        ? prev.map(c => c.pid === prod.id ? { ...c, counted: c.counted + qty } : c)
        : [{ barcode: prod.barcode || '', pid: prod.id, name: prod.name, counted: qty, system: prod.stock || 0, unit: prod.unit || 'ชิ้น' }, ...prev]
      localStorage.setItem('stock_count_session', JSON.stringify(next))
      return next
    })
  }, [flashMsg])

  const processBarcode = useCallback((raw) => {
    const bc = convertThaiBarcode(raw.trim()).toUpperCase()
    if (!bc) return
    const prod = productsRef.current.find(p =>
      (p.barcode || '').toUpperCase() === bc ||
      (p.alt_barcode || '').toUpperCase() === bc
    )
    if (!prod) { flashMsg(`ไม่พบสินค้า: ${bc}`, false); return }
    addProduct(prod)
  }, [flashMsg, addProduct])

  function handleInputKey(e) {
    if (e.key === 'Enter') {
      processBarcode(scanInput)
      setScanInput('')
    }
  }

  // name search
  function handleNameSearch(v) {
    setNameSearch(v)
    if (!v.trim()) { setNameSuggestions([]); return }
    const q = v.toLowerCase()
    const matched = productsRef.current
      .filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q)
        || (p.alt_barcode || '').toLowerCase().includes(q)
        || (p.categories?.name || '').toLowerCase().includes(q)
        || (p.unit || '').toLowerCase().includes(q)
        || (p.search_tags || '').toLowerCase().includes(q))
      .slice(0, 15)
    setNameSuggestions(matched)
  }

  function pickSuggestion(prod) {
    setNameSearch('')
    setNameSuggestions([])
    addProduct(prod)
    inputRef.current?.focus()
  }

  async function openCamera() {
    setCameraOpen(true)
    await new Promise(r => setTimeout(r, 200))
    try {
      if ('BarcodeDetector' in window) {
        setCamDbg('กำลังขอสิทธิ์กล้อง (BD)…')
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        scannerRef.current = stream

        let supportedFormats = ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code']
        try {
          const all = await window.BarcodeDetector.getSupportedFormats()
          supportedFormats = supportedFormats.filter(f => all.includes(f))
          setCamDbg(`BD: ${supportedFormats.join(',')}`)
        } catch (e2) { setCamDbg('BD formats err: ' + e2.message) }

        const detector = new window.BarcodeDetector({ formats: supportedFormats.length ? supportedFormats : ['qr_code'] })

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await new Promise(res => {
            if (videoRef.current.readyState >= 1) { res(); return }
            videoRef.current.onloadedmetadata = res
          })
          await videoRef.current.play()
          setCamDbg(`playing ${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`)
        }

        let lastCode = '', lastTime = 0, scanning = false
        const scan = async () => {
          const vid = videoRef.current
          if (!vid || vid.readyState < 2 || vid.videoWidth === 0 || scanning) return
          scanning = true
          try {
            const results = await detector.detect(vid)
            if (results.length > 0) {
              const code = results[0].rawValue
              const now = Date.now()
              if (code !== lastCode || now - lastTime > 2000) {
                lastCode = code; lastTime = now
                processBarcode(code)
                if (navigator.vibrate) navigator.vibrate(80)
              }
            }
          } catch {}
          scanning = false
        }
        const ivId = setInterval(scan, 250)
        rafRef.current = { cancel: () => clearInterval(ivId) }

      } else {
        setCamDbg('iOS 16: ใช้ html5-qrcode')
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        const scanner = new Html5Qrcode('stock-qr-reader', {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
          verbose: false,
        })
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 15 },
          (text) => { processBarcode(text); if (navigator.vibrate) navigator.vibrate(80) },
          () => {}
        )
        setCamDbg('html5-qrcode กำลัง scan…')
      }
    } catch (e) {
      setCamDbg('ERROR: ' + e.message)
      flashMsg('เปิดกล้องไม่ได้: ' + (e?.message || 'ไม่รองรับ'), false)
      setCameraOpen(false)
    }
  }

  async function closeCamera() {
    if (rafRef.current) {
      if (typeof rafRef.current.cancel === 'function') rafRef.current.cancel()
      else cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    try {
      if (scannerRef.current instanceof MediaStream) {
        scannerRef.current.getTracks().forEach(t => t.stop())
      } else if (scannerRef.current) {
        await scannerRef.current.stop()
        scannerRef.current.clear()
      }
      scannerRef.current = null
    } catch {}
    if (videoRef.current) { videoRef.current.srcObject = null }
    setCameraOpen(false)
    inputRef.current?.focus()
  }

  function adjustCount(pid, delta) {
    setCounts(prev => {
      const next = prev.map(c => c.pid === pid
        ? { ...c, counted: Math.max(0, c.counted + delta) }
        : c
      ).filter(c => c.counted > 0)
      localStorage.setItem('stock_count_session', JSON.stringify(next))
      return next
    })
  }

  function removeItem(pid) {
    setCounts(prev => {
      const next = prev.filter(c => c.pid !== pid)
      localStorage.setItem('stock_count_session', JSON.stringify(next))
      return next
    })
  }

  function handleReset() {
    if (!confirm('ล้างข้อมูลนับสต๊อกทั้งหมด?')) return
    setCounts([])
    localStorage.removeItem('stock_count_session')
  }

  function saveDraft() {
    localStorage.setItem('stock_count_session', JSON.stringify(counts))
    localStorage.setItem('stock_count_saved_at', new Date().toLocaleString('th-TH'))
    setDraftSaved(true)
    setTimeout(() => setDraftSaved(false), 2500)
  }

  async function openApplyModal() {
    if (!counts.length) return
    const pids = counts.map(c => c.pid).filter(Boolean)
    const { data } = await supabase.from('products').select('id,stock').in('id', pids)
    const stockMap = Object.fromEntries((data || []).map(p => [p.id, Number(p.stock) || 0]))
    setApplyPreview(counts.map(c => ({
      pid: c.pid, name: c.name, unit: c.unit || 'ชิ้น',
      counted: c.counted,
      stockBefore: stockMap[c.pid] ?? Number(c.system) ?? 0,
    })))
    setShowApplyModal(true)
  }

  function stockAfter(item, mode) {
    if (mode === 'add')    return item.stockBefore + item.counted
    if (mode === 'reduce') return Math.max(0, item.stockBefore - item.counted)
    return item.counted // reset / นับใหม่
  }

  async function applyToStock() {
    setApplying(true)
    try {
      for (const item of applyPreview) {
        await supabase.from('products').update({ stock: stockAfter(item, applyMode) }).eq('id', item.pid)
      }
      setShowApplyModal(false)
      setCounts([])
      localStorage.removeItem('stock_count_session')
      flashMsg(`✅ ปรับสต๊อก ${applyPreview.length} รายการเสร็จแล้ว`)
    } catch (e) {
      flashMsg('เกิดข้อผิดพลาด: ' + e.message, false)
    } finally {
      setApplying(false)
    }
  }

  function handleExport() {
    const rows = [['บาร์โค้ด', 'ชื่อสินค้า', 'นับได้', 'ระบบ', 'ต่าง']]
    counts.forEach(c => rows.push([c.barcode, c.name, c.counted, c.system, c.counted - c.system]))
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `stock-count-${new Date().toLocaleDateString('sv-SE')}.csv`
    a.click()
  }

  const totalItems = counts.reduce((s, c) => s + c.counted, 0)
  const diffCount  = counts.filter(c => c.counted !== c.system).length

  return (
    <div className="p-4 max-w-2xl mx-auto pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-slate-700">📦 นับสต๊อก</h1>
        <div className="flex gap-2">
          {counts.length > 0 && (
            <button onClick={handleExport}
              className="text-sm text-brand border border-brand px-3 py-1.5 rounded-lg font-medium">
              CSV
            </button>
          )}
          <button onClick={handleReset}
            className="text-sm text-red-500 border border-red-300 px-3 py-1.5 rounded-lg font-medium">
            ล้าง
          </button>
        </div>
      </div>

      {/* Camera */}
      {cameraOpen && (
        <div className="relative -mx-4 overflow-hidden flex-shrink-0 bg-black" style={{ height: 260 }}>
          {/* Native BarcodeDetector path */}
          <video ref={videoRef} playsInline muted
            className="w-full h-full object-cover"
            style={{ display: hasBD ? 'block' : 'none' }} />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          {/* html5-qrcode fallback */}
          <div id="stock-qr-reader" className="w-full h-full"
            style={{ display: hasBD ? 'none' : 'block' }} />
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-3 pb-6 pointer-events-none"
            style={{ background: 'linear-gradient(to bottom,rgba(0,0,0,0.6),transparent)' }}>
            <span className="text-white text-sm font-medium">📷 จ่อกล้องที่บาร์โค้ด</span>
          </div>
          <button onClick={closeCamera}
            className="absolute top-3 right-4 z-20 text-white text-xl font-bold w-8 h-8 flex items-center justify-center active:opacity-60"
            style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 20 }}>✕</button>
          {camDbg ? (
            <div className="absolute bottom-10 left-2 right-2 z-10 bg-black/70 text-white text-[10px] px-2 py-1 rounded break-all">{camDbg}</div>
          ) : null}
          {lastMsg && (
            <div className={`absolute bottom-3 left-3 right-3 z-10 py-2.5 px-4 rounded-2xl text-center font-bold text-sm shadow-lg ${lastMsg.ok ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
              {lastMsg.text}
            </div>
          )}
        </div>
      )}

      {/* Barcode scanner input + camera button */}
      <div className="mb-3 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={scanInput}
          onChange={e => setScanInput(e.target.value)}
          onKeyDown={handleInputKey}
          onBlur={() => !cameraOpen && setTimeout(() => inputRef.current?.focus(), 80)}
          placeholder="สแกนหรือพิมพ์บาร์โค้ด…"
          className="flex-1 border-2 border-brand rounded-xl px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-brand/50"
          style={{ fontFamily: 'var(--font-kanit), sans-serif' }}
        />
        <button onClick={cameraOpen ? closeCamera : openCamera}
          className="text-white rounded-xl px-4 py-3 text-2xl flex-shrink-0 active:opacity-80 flex items-center justify-center"
          style={{ background: cameraOpen ? '#64748b' : '#C72C41' }}>
          {cameraOpen ? '⏹' : '📷'}
        </button>
      </div>

      {/* Flash message (เมื่อปิดกล้อง) */}
      {!cameraOpen && lastMsg && (
        <div className={`text-base mb-3 px-4 py-2.5 rounded-xl font-medium ${lastMsg.ok ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
          {lastMsg.text}
        </div>
      )}

      {/* Name search */}
      <div className="relative mb-4">
        <input
          type="text"
          value={nameSearch}
          onChange={e => handleNameSearch(e.target.value)}
          onBlur={() => setTimeout(() => setNameSuggestions([]), 200)}
          placeholder="🔍 ค้นหาชื่อสินค้า / บาร์โค้ด แล้วกดเลือก"
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand bg-slate-50"
        />
        {nameSuggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-40 max-h-64 overflow-y-auto">
            {nameSuggestions.map(p => (
              <li key={p.id} onMouseDown={() => pickSuggestion(p)}
                className="px-4 py-2.5 flex justify-between items-center hover:bg-brand/5 cursor-pointer border-b border-slate-50 last:border-0 active:bg-brand/10">
                <div>
                  <div className="font-semibold text-slate-800 text-sm">{p.name}</div>
                  <div className="text-xs text-slate-400">{p.barcode || '—'}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs text-slate-500">สต็อก {fmt(p.stock)} {p.unit}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-white rounded-xl p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-slate-700">{counts.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">SKU</div>
        </div>
        <div className="bg-white rounded-xl p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-slate-700">{fmt(totalItems)}</div>
          <div className="text-xs text-slate-500 mt-0.5">ชิ้นทั้งหมด</div>
        </div>
        <div className={`rounded-xl p-3 text-center shadow-sm ${diffCount > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
          <div className={`text-2xl font-bold ${diffCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{diffCount}</div>
          <div className="text-xs text-slate-500 mt-0.5">ต่างจากระบบ</div>
        </div>
      </div>

      {/* Count list */}
      {/* Draft saved flash */}
      {draftSaved && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-500 text-white text-sm font-bold px-5 py-2.5 rounded-2xl shadow-lg">
          ✓ บันทึกร่างแล้ว
        </div>
      )}

      {counts.length === 0 ? (
        <div className="text-center text-slate-400 py-16">
          <div className="text-5xl mb-4">📷</div>
          <p className="text-base">กด 📷 สแกนด้วยกล้อง หรือค้นหาชื่อสินค้า</p>
          <p className="text-sm mt-1 text-slate-300">รองรับบาร์โค้ดสแกนเนอร์ด้วย</p>
        </div>
      ) : (
        <div className="space-y-2">
          {counts.map(c => {
            const diff = c.counted - c.system
            return (
              <div key={c.pid || c.barcode} className="bg-white rounded-xl p-3.5 shadow-sm flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-700 text-sm leading-tight">{c.name}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{c.barcode || '—'}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    ระบบ: <span className="font-medium">{fmt(c.system)}</span> {c.unit || 'ชิ้น'}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => adjustCount(c.pid, -1)}
                    className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-lg flex items-center justify-center active:scale-95">
                    −
                  </button>
                  <span className="text-xl font-bold text-slate-700 w-10 text-center">{c.counted}</span>
                  <button onClick={() => adjustCount(c.pid, 1)}
                    className="w-8 h-8 rounded-full font-bold text-lg flex items-center justify-center active:scale-95"
                    style={{ background: 'rgba(199,44,65,0.1)', color: '#C72C41' }}>
                    +
                  </button>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <div className={`text-sm font-bold w-10 text-right ${
                    diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'
                  }`}>
                    {diff === 0 ? '✓' : diff > 0 ? `+${diff}` : `${diff}`}
                  </div>
                  <button onClick={() => removeItem(c.pid)}
                    className="text-[10px] text-slate-300 hover:text-red-400 active:text-red-500">ลบ</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Sticky footer */}
      {counts.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 px-4 pb-safe-area-inset-bottom"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)', background: 'linear-gradient(to top, #f8fafc 80%, transparent)' }}>
          <div className="flex gap-3 pb-3 max-w-2xl mx-auto">
            <button onClick={saveDraft}
              className="flex-1 py-3.5 rounded-2xl text-base font-bold border-2 border-slate-300 text-slate-600 active:bg-slate-100 transition-colors relative overflow-hidden"
              style={{ background: draftSaved ? '#f0fdf4' : '#fff', borderColor: draftSaved ? '#86efac' : undefined, color: draftSaved ? '#16a34a' : undefined }}>
              {draftSaved ? '✓ บันทึกแล้ว' : '💾 บันทึกร่าง'}
            </button>
            <button onClick={openApplyModal}
              className="flex-1 py-3.5 rounded-2xl text-base font-bold text-white active:opacity-90 transition-opacity"
              style={{ background: 'linear-gradient(135deg,#C72C41,#801336)' }}>
              ✅ ปรับสต๊อก
            </button>
          </div>
        </div>
      )}

      {/* Apply modal */}
      {showApplyModal && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowApplyModal(false) }}>
          <div className="w-full max-w-2xl mx-auto bg-white rounded-t-3xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="px-5 pt-5 pb-3 flex-shrink-0">
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
              <h2 className="text-lg font-bold text-slate-800 mb-3">ปรับสต๊อก</h2>
              {/* Mode tabs */}
              <div className="flex gap-2 mb-1">
                {[
                  { key: 'add',    label: '+ เพิ่ม',   desc: 'บวกจำนวนที่นับเข้าสต๊อก' },
                  { key: 'reduce', label: '− ลด',      desc: 'หักจำนวนที่นับออกจากสต๊อก' },
                  { key: 'reset',  label: '↺ นับใหม่', desc: 'ตั้งสต๊อกเป็นจำนวนที่นับได้' },
                ].map(m => (
                  <button key={m.key} onClick={() => setApplyMode(m.key)}
                    className="flex-1 py-2 rounded-xl text-sm font-bold transition-all"
                    style={applyMode === m.key
                      ? { background: '#C72C41', color: '#fff' }
                      : { background: '#f1f5f9', color: '#64748b' }}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 text-center mt-1.5">
                {applyMode === 'add'    && 'สต๊อกใหม่ = สต๊อกเดิม + จำนวนที่นับ'}
                {applyMode === 'reduce' && 'สต๊อกใหม่ = สต๊อกเดิม − จำนวนที่นับ'}
                {applyMode === 'reset'  && 'สต๊อกใหม่ = จำนวนที่นับได้ (ตั้งค่าใหม่)'}
              </p>
            </div>

            {/* Preview list */}
            <div className="flex-1 overflow-y-auto px-4 pb-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-xs text-slate-400 border-b">
                    <th className="text-left py-2 font-medium">สินค้า</th>
                    <th className="text-right py-2 font-medium">เดิม</th>
                    <th className="text-right py-2 font-medium">นับ</th>
                    <th className="text-right py-2 font-medium text-slate-700">ใหม่</th>
                  </tr>
                </thead>
                <tbody>
                  {applyPreview.map(item => {
                    const after = stockAfter(item, applyMode)
                    const diff = after - item.stockBefore
                    return (
                      <tr key={item.pid} className="border-b border-slate-50">
                        <td className="py-2 pr-2">
                          <div className="font-medium text-slate-700 leading-tight">{item.name}</div>
                          <div className="text-[10px] text-slate-400">{item.unit}</div>
                        </td>
                        <td className="py-2 text-right text-slate-500">{fmt(item.stockBefore)}</td>
                        <td className="py-2 text-right text-slate-500">{fmt(item.counted)}</td>
                        <td className="py-2 text-right font-bold">
                          <span className={diff > 0 ? 'text-blue-600' : diff < 0 ? 'text-red-600' : 'text-green-600'}>
                            {fmt(after)}
                          </span>
                          <div className="text-[10px] font-normal text-slate-400">
                            {diff === 0 ? '±0' : diff > 0 ? `+${fmt(diff)}` : fmt(diff)}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Confirm */}
            <div className="px-4 py-4 flex-shrink-0 border-t border-slate-100">
              <button onClick={applyToStock} disabled={applying}
                className="w-full py-4 rounded-2xl text-base font-bold text-white active:opacity-90 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#C72C41,#801336)' }}>
                {applying ? 'กำลังบันทึก…' : `ยืนยัน ปรับสต๊อก ${applyPreview.length} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Sticky footer ── */}
      {counts.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 flex gap-3 z-30 shadow-lg">
          <button onClick={saveDraft}
            className="flex-1 py-3 rounded-xl border-2 border-slate-300 text-slate-700 font-bold text-sm active:bg-slate-50">
            💾 บันทึกร่าง
          </button>
          <button onClick={openApplyModal}
            className="flex-1 py-3 rounded-xl text-white font-bold text-sm active:opacity-90"
            style={{ background: 'linear-gradient(135deg,#C72C41,#EE4540)' }}>
            ✅ ปรับสต๊อก
          </button>
        </div>
      )}

      {/* ── Apply Modal ── */}
      {showApplyModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end md:items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) setShowApplyModal(false) }}>
          <div className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-3xl overflow-hidden max-h-[90vh] flex flex-col">
            {/* Modal header */}
            <div className="px-5 pt-5 pb-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-base">ปรับสต๊อก {applyPreview.length} รายการ</h2>
              <button onClick={() => setShowApplyModal(false)} className="text-slate-300 text-2xl leading-none">×</button>
            </div>

            {/* Mode tabs */}
            <div className="flex gap-2 px-5 pt-4 pb-2">
              {[['add','+ เพิ่ม','bg-blue-500'],['reduce','− ลด','bg-red-500'],['reset','↺ นับใหม่','bg-green-600']].map(([m,label,cls]) => (
                <button key={m} onClick={() => setApplyMode(m)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${applyMode===m ? cls+' text-white shadow' : 'bg-slate-100 text-slate-500'}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 text-center pb-2">
              {applyMode==='add'    ? 'สต๊อกใหม่ = สต๊อกเดิม + จำนวนที่นับ' :
               applyMode==='reduce' ? 'สต๊อกใหม่ = สต๊อกเดิม − จำนวนที่นับ' :
                                      'สต๊อกใหม่ = จำนวนที่นับ (นับใหม่ทั้งหมด)'}
            </p>

            {/* Preview table */}
            <div className="overflow-y-auto flex-1 px-3 pb-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-[10px] text-slate-400 font-semibold uppercase">
                    <th className="text-left py-2 pl-2">สินค้า</th>
                    <th className="text-center py-2 w-14">เดิม</th>
                    <th className="text-center py-2 w-14">นับ</th>
                    <th className="text-center py-2 w-14">ใหม่</th>
                  </tr>
                </thead>
                <tbody>
                  {applyPreview.map(item => {
                    const after = stockAfter(item, applyMode)
                    const diff = after - item.stockBefore
                    return (
                      <tr key={item.pid} className="border-t border-slate-50">
                        <td className="py-2 pl-2 text-xs text-slate-700 font-medium leading-tight">{item.name}</td>
                        <td className="text-center py-2 text-xs text-slate-400">{fmt(item.stockBefore)}</td>
                        <td className="text-center py-2 text-xs text-slate-600 font-semibold">{fmt(item.counted)}</td>
                        <td className="text-center py-2 font-bold text-sm">
                          <span className={diff > 0 ? 'text-blue-600' : diff < 0 ? 'text-red-500' : 'text-green-600'}>
                            {fmt(after)}
                          </span>
                          {diff !== 0 && (
                            <div className={`text-[10px] font-normal ${diff>0?'text-blue-400':'text-red-400'}`}>
                              {diff > 0 ? '+' : ''}{diff}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Confirm */}
            <div className="px-5 pb-5 pt-3 border-t border-slate-100">
              <button onClick={applyToStock} disabled={applying}
                className="w-full py-3.5 rounded-2xl text-white font-bold text-base disabled:opacity-50 active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg,#C72C41,#EE4540)' }}>
                {applying ? '⏳ กำลังอัปเดต...' : `✅ ยืนยันปรับสต๊อก ${applyPreview.length} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
