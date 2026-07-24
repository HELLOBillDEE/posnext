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
  const [lastMsg, setLastMsg]     = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const inputRef    = useRef(null)
  const productsRef = useRef([])
  const scannerRef  = useRef(null)

  useEffect(() => { productsRef.current = products }, [products])

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
    await new Promise(r => setTimeout(r, 300))
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
      const scanner = new Html5Qrcode('stock-qr-reader', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
        verbose: false,
      })
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => ({ width: Math.round(w * 0.85), height: Math.round(h * 0.35) }) },
        (text) => { processBarcode(text); if (navigator.vibrate) navigator.vibrate(80) },
        () => {}
      )
    } catch (e) {
      flashMsg('เปิดกล้องไม่ได้: ' + (e?.message || 'ไม่รองรับ'), false)
      setCameraOpen(false)
    }
  }

  async function closeCamera() {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop()
        scannerRef.current.clear()
        scannerRef.current = null
      }
    } catch {}
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

      {/* Camera — ครึ่งบน */}
      {cameraOpen && (
        <div className="relative -mx-4 overflow-hidden flex-shrink-0" style={{ height: 260 }}>
          <div id="stock-qr-reader" className="w-full h-full" />
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-3 pb-6 pointer-events-none"
            style={{ background: 'linear-gradient(to bottom,rgba(0,0,0,0.6),transparent)' }}>
            <span className="text-white text-sm font-medium">📷 จ่อกล้องที่บาร์โค้ด</span>
          </div>
          <button onClick={closeCamera}
            className="absolute top-3 right-4 z-20 text-white text-xl font-bold w-8 h-8 flex items-center justify-center active:opacity-60"
            style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 20 }}>✕</button>
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
    </div>
  )
}
