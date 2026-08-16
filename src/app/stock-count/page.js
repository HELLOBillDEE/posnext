'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { convertThaiBarcode } from '@/lib/utils'

const fmt = n => Number(n || 0).toLocaleString('th-TH')
const fmtDate = s => new Date(s).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function StockCountPage() {
  const [view, setView]               = useState('loading')
  const [myName, setMyName]           = useState('')
  const [nameInput, setNameInput]     = useState('')
  const [sessions, setSessions]       = useState([])
  const [session, setSession]         = useState(null)
  const [counts, setCounts]           = useState({})
  const [products, setProducts]       = useState([])
  const [categories, setCategories]   = useState([])
  const [catFilter, setCatFilter]     = useState([])
  const [blind, setBlind]             = useState(false)
  const [scanInput, setScanInput]     = useState('')
  const [nameSearch, setNameSearch]   = useState('')
  const [nameSuggestions, setNameSuggestions] = useState([])
  const [lastMsg, setLastMsg]         = useState(null)
  const [cameraOpen, setCameraOpen]   = useState(false)
  const [hasBD, setHasBD]             = useState(false)
  const [camDbg, setCamDbg]           = useState('')
  const [showCreate, setShowCreate]   = useState(false)
  const [newSName, setNewSName]       = useState('')
  const [newBlind, setNewBlind]       = useState(false)
  const [newCats, setNewCats]         = useState([])
  const [creating, setCreating]       = useState(false)
  const [showApply, setShowApply]     = useState(false)
  const [applyMode, setApplyMode]     = useState('reset')
  const [applyPreview, setApplyPreview] = useState([])
  const [applying, setApplying]       = useState(false)
  const [showCatPanel, setShowCatPanel] = useState(false)
  const [loadingSess, setLoadingSess] = useState(false)

  const inputRef     = useRef(null)
  const productsRef  = useRef([])
  const myCountsRef  = useRef({})
  const scannerRef   = useRef(null)
  const videoRef     = useRef(null)
  const canvasRef    = useRef(null)
  const rafRef       = useRef(null)
  const sessionRef   = useRef(null)
  const catFilterRef = useRef([])

  useEffect(() => { productsRef.current = products }, [products])
  useEffect(() => { sessionRef.current = session },   [session])
  useEffect(() => { catFilterRef.current = catFilter }, [catFilter])
  useEffect(() => { setHasBD(typeof window !== 'undefined' && 'BarcodeDetector' in window) }, [])

  // Init
  useEffect(() => {
    const saved = localStorage.getItem('scount_my_name')
    if (saved) { setMyName(saved); init(saved) }
    else setView('name-setup')
  }, [])

  async function init(name) {
    await Promise.all([loadSessions(), loadProducts()])
    setView('sessions')
  }

  async function loadProducts() {
    const all = []; let from = 0
    while (true) {
      const { data } = await supabase.from('products')
        .select('id,name,barcode,alt_barcode,stock,unit,search_tags,categories(id,name)')
        .range(from, from + 999)
      if (!data?.length) break
      all.push(...data)
      if (data.length < 1000) break
      from += 1000
    }
    setProducts(all); productsRef.current = all
    const catMap = {}
    all.forEach(p => { if (p.categories?.id) catMap[p.categories.id] = p.categories.name })
    setCategories(Object.entries(catMap).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'th')))
  }

  async function loadSessions() {
    setLoadingSess(true)
    const { data } = await supabase.from('stock_count_sessions')
      .select('*').eq('status', 'counting').order('created_at', { ascending: false })
    setSessions(data || [])
    setLoadingSess(false)
  }

  function saveName() {
    const n = nameInput.trim()
    if (!n) return
    localStorage.setItem('scount_my_name', n)
    setMyName(n)
    init(n)
  }

  const flashMsg = useCallback((text, ok = true) => {
    setLastMsg({ text, ok })
    setTimeout(() => setLastMsg(null), 3000)
  }, [])

  // ─── JOIN SESSION ─────────────────────────────────────────────────────────
  async function joinSession(s) {
    setSession(s); sessionRef.current = s
    setBlind(s.blind); myCountsRef.current = {}
    if (s.category_filter?.length) { setCatFilter(s.category_filter); catFilterRef.current = s.category_filter }

    const { data } = await supabase.from('stock_count_items').select('*').eq('session_id', s.id)
    const map = {}
    if (data) {
      data.forEach(row => {
        if (!map[row.product_id]) map[row.product_id] = { name: row.product_name, barcode: row.barcode || '', system: 0, unit: 'ชิ้น', catName: '', counters: {} }
        map[row.product_id].counters[row.counted_by] = row.counted
        if (row.counted_by === (localStorage.getItem('scount_my_name') || '')) myCountsRef.current[row.product_id] = row.counted
      })
      const pids = Object.keys(map)
      if (pids.length) {
        const { data: prods } = await supabase.from('products').select('id,stock,unit,categories(name)').in('id', pids)
        prods?.forEach(p => { if (map[p.id]) { map[p.id].system = p.stock || 0; map[p.id].unit = p.unit || 'ชิ้น'; map[p.id].catName = p.categories?.name || '' } })
      }
    }
    setCounts(map)
    setView('counting')
    setTimeout(() => inputRef.current?.focus(), 200)
  }

  // ─── REALTIME ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const me = localStorage.getItem('scount_my_name') || ''
    const ch = supabase.channel(`scount-${session.id}`)
      .on('postgres_changes', { event: '*', schema: 'pos', table: 'stock_count_items', filter: `session_id=eq.${session.id}` }, ({ new: row, eventType }) => {
        if (!row?.product_id || row.counted_by === me) return
        setCounts(prev => {
          const existing = prev[row.product_id] || { name: row.product_name, barcode: row.barcode || '', system: 0, unit: 'ชิ้น', catName: '', counters: {} }
          if (eventType === 'DELETE') {
            const { [row.counted_by]: _, ...rest } = existing.counters
            return { ...prev, [row.product_id]: { ...existing, counters: rest } }
          }
          return { ...prev, [row.product_id]: { ...existing, counters: { ...existing.counters, [row.counted_by]: row.counted } } }
        })
      }).subscribe()
    return () => supabase.removeChannel(ch)
  }, [session?.id])

  // ─── ADD PRODUCT ─────────────────────────────────────────────────────────
  const addProduct = useCallback(async (prod, qty = 1) => {
    const sess = sessionRef.current
    if (!sess) return
    const me = localStorage.getItem('scount_my_name') || ''
    const pid = prod.id.toString()
    const cf = catFilterRef.current

    if (cf.length > 0 && !cf.includes(prod.categories?.name)) {
      flashMsg(`⚠️ นอกโซน: ${prod.name}`, false); return
    }

    myCountsRef.current[pid] = (myCountsRef.current[pid] || 0) + qty
    const newCount = myCountsRef.current[pid]

    setCounts(prev => {
      const existing = prev[pid] || { name: prod.name, barcode: prod.barcode || '', system: prod.stock || 0, unit: prod.unit || 'ชิ้น', catName: prod.categories?.name || '', counters: {} }
      return { ...prev, [pid]: { ...existing, counters: { ...existing.counters, [me]: newCount } } }
    })
    flashMsg(`+${qty} ${prod.name}`)

    supabase.from('stock_count_items').upsert({
      session_id: sess.id, product_id: pid, product_name: prod.name,
      barcode: prod.barcode || '', counted_by: me, counted: newCount,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'session_id,product_id,counted_by' }).then()
  }, [flashMsg])

  const processBarcode = useCallback((raw) => {
    const bc = convertThaiBarcode(raw.trim()).toUpperCase()
    if (!bc) return
    const prod = productsRef.current.find(p => (p.barcode || '').toUpperCase() === bc || (p.alt_barcode || '').toUpperCase() === bc)
    if (!prod) { flashMsg(`ไม่พบ: ${bc}`, false); return }
    addProduct(prod)
  }, [flashMsg, addProduct])

  function handleInputKey(e) {
    if (e.key === 'Enter') { processBarcode(scanInput); setScanInput('') }
  }

  function handleNameSearch(v) {
    setNameSearch(v)
    if (!v.trim()) { setNameSuggestions([]); return }
    const q = v.toLowerCase()
    const filtered = productsRef.current.filter(p => catFilter.length === 0 || catFilter.includes(p.categories?.name))
    setNameSuggestions(filtered.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q) || (p.search_tags || '').toLowerCase().includes(q)).slice(0, 15))
  }

  function pickSuggestion(prod) {
    setNameSearch(''); setNameSuggestions([])
    addProduct(prod); inputRef.current?.focus()
  }

  // ─── CAMERA ──────────────────────────────────────────────────────────────
  async function openCamera() {
    setCameraOpen(true)
    await new Promise(r => setTimeout(r, 200))
    try {
      if ('BarcodeDetector' in window) {
        setCamDbg('กำลังขอสิทธิ์กล้อง…')
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } })
        scannerRef.current = stream
        let fmts = ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code']
        try { const all = await window.BarcodeDetector.getSupportedFormats(); fmts = fmts.filter(f => all.includes(f)) } catch {}
        const detector = new window.BarcodeDetector({ formats: fmts.length ? fmts : ['qr_code'] })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await new Promise(res => { if (videoRef.current.readyState >= 1) { res(); return }; videoRef.current.onloadedmetadata = res })
          await videoRef.current.play()
          setCamDbg('')
        }
        let lastCode = '', lastTime = 0, scanning = false
        const scan = async () => {
          const vid = videoRef.current
          if (!vid || vid.readyState < 2 || vid.videoWidth === 0 || scanning) return
          scanning = true
          try {
            const results = await detector.detect(vid)
            if (results.length > 0) {
              const code = results[0].rawValue; const now = Date.now()
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
        setCamDbg('ใช้ html5-qrcode…')
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        const scanner = new Html5Qrcode('stock-qr-reader', { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E, Html5QrcodeSupportedFormats.QR_CODE], verbose: false })
        scannerRef.current = scanner
        await scanner.start({ facingMode: 'environment' }, { fps: 15 }, (text) => { processBarcode(text); if (navigator.vibrate) navigator.vibrate(80) }, () => {})
        setCamDbg('')
      }
    } catch (e) {
      setCamDbg(''); flashMsg('เปิดกล้องไม่ได้: ' + (e?.message || ''), false); setCameraOpen(false)
    }
  }

  async function closeCamera() {
    if (rafRef.current) { if (typeof rafRef.current.cancel === 'function') rafRef.current.cancel(); else cancelAnimationFrame(rafRef.current); rafRef.current = null }
    try {
      if (scannerRef.current instanceof MediaStream) scannerRef.current.getTracks().forEach(t => t.stop())
      else if (scannerRef.current) { await scannerRef.current.stop(); scannerRef.current.clear() }
      scannerRef.current = null
    } catch {}
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOpen(false); inputRef.current?.focus()
  }

  // ─── CREATE SESSION ───────────────────────────────────────────────────────
  async function createSession() {
    if (!newSName.trim()) return
    setCreating(true)
    try {
      const { data, error } = await supabase.from('stock_count_sessions').insert({
        name: newSName.trim(), blind: newBlind,
        category_filter: newCats.length ? newCats : null,
        status: 'counting',
      }).select().single()
      if (error) throw error
      setShowCreate(false); setNewSName(''); setNewBlind(false); setNewCats([])
      await joinSession(data)
    } catch (e) { flashMsg('สร้างไม่ได้: ' + e.message, false) }
    finally { setCreating(false) }
  }

  // ─── ADJUST / REMOVE ──────────────────────────────────────────────────────
  function adjustMyCount(pid, delta) {
    const me = localStorage.getItem('scount_my_name') || ''
    const newCount = Math.max(0, (myCountsRef.current[pid] || 0) + delta)
    myCountsRef.current[pid] = newCount
    setCounts(prev => {
      const existing = prev[pid]; if (!existing) return prev
      if (newCount === 0) {
        supabase.from('stock_count_items').delete().match({ session_id: session.id, product_id: pid, counted_by: me }).then()
        const { [me]: _, ...rest } = existing.counters
        const next = { ...existing, counters: rest }
        if (Object.keys(rest).length === 0) { const { [pid]: __, ...p } = prev; return p }
        return { ...prev, [pid]: next }
      }
      supabase.from('stock_count_items').upsert({ session_id: session.id, product_id: pid, product_name: existing.name, barcode: existing.barcode, counted_by: me, counted: newCount, updated_at: new Date().toISOString() }, { onConflict: 'session_id,product_id,counted_by' }).then()
      return { ...prev, [pid]: { ...existing, counters: { ...existing.counters, [me]: newCount } } }
    })
  }

  // ─── APPLY ────────────────────────────────────────────────────────────────
  async function openApplyModal() {
    const pids = Object.keys(counts)
    const { data: fresh } = await supabase.from('products').select('id,stock').in('id', pids)
    const stockMap = Object.fromEntries((fresh || []).map(p => [p.id, Number(p.stock) || 0]))
    setApplyPreview(Object.entries(counts).map(([pid, d]) => ({
      pid, name: d.name, unit: d.unit,
      counted: Object.values(d.counters).reduce((s, n) => s + n, 0),
      stockBefore: stockMap[pid] ?? d.system,
      contributors: Object.entries(d.counters),
    })))
    setShowApply(true)
  }

  function stockAfter(item, mode) {
    if (mode === 'add')    return item.stockBefore + item.counted
    if (mode === 'reduce') return Math.max(0, item.stockBefore - item.counted)
    return item.counted
  }

  async function applyToStock() {
    setApplying(true)
    try {
      for (const item of applyPreview) {
        await supabase.from('products').update({ stock: stockAfter(item, applyMode) }).eq('id', item.pid)
      }
      await supabase.from('stock_count_sessions').update({ status: 'done', applied_at: new Date().toISOString() }).eq('id', session.id)
      setShowApply(false); flashMsg(`✅ ปรับสต๊อก ${applyPreview.length} รายการ`)
      setCounts({}); myCountsRef.current = {}; setSession(null); setView('sessions'); loadSessions()
    } catch (e) { flashMsg('เกิดข้อผิดพลาด: ' + e.message, false) }
    finally { setApplying(false) }
  }

  // ─── DERIVED ─────────────────────────────────────────────────────────────
  const me = myName
  const countsList = Object.entries(counts)
    .filter(([, d]) => catFilter.length === 0 || catFilter.includes(d.catName))
    .map(([pid, d]) => ({
      pid, name: d.name, barcode: d.barcode, system: d.system, unit: d.unit,
      total: Object.values(d.counters).reduce((s, n) => s + n, 0),
      myCount: d.counters[me] || 0,
      others: Object.entries(d.counters).filter(([n]) => n !== me),
    }))
  const totalItems = countsList.reduce((s, c) => s + c.total, 0)
  const diffCount  = countsList.filter(c => c.total !== c.system).length
  const allCount   = Object.values(counts).reduce((s, d) => s + Object.values(d.counters).reduce((a, n) => a + n, 0), 0)

  // ─── VIEWS ───────────────────────────────────────────────────────────────

  if (view === 'loading') {
    return <div className="flex items-center justify-center h-screen text-slate-400">กำลังโหลด…</div>
  }

  if (view === 'name-setup') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <div className="bg-white rounded-3xl shadow-xl p-8 w-full max-w-sm">
          <div className="text-4xl text-center mb-4">📦</div>
          <h1 className="text-xl font-bold text-slate-700 text-center mb-1">นับสต๊อก</h1>
          <p className="text-sm text-slate-400 text-center mb-6">ระบุชื่อของคุณเพื่อเริ่มนับ</p>
          <input
            autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveName()}
            placeholder="ชื่อผู้นับ เช่น สมชาย"
            className="w-full border-2 border-slate-200 focus:border-brand rounded-2xl px-4 py-3 text-base mb-4 outline-none text-center font-medium"
          />
          <button onClick={saveName} disabled={!nameInput.trim()}
            className="w-full py-3.5 rounded-2xl text-white font-bold text-base disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#C72C41,#801336)' }}>
            เริ่มเลย →
          </button>
        </div>
      </div>
    )
  }

  // ─── SESSIONS LIST ────────────────────────────────────────────────────────
  if (view === 'sessions') {
    return (
      <div className="p-4 max-w-2xl mx-auto pb-20">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-slate-700">📦 นับสต๊อก</h1>
            <p className="text-xs text-slate-400 mt-0.5">ผู้นับ: <span className="font-semibold text-brand">{myName}</span> <button onClick={() => { localStorage.removeItem('scount_my_name'); setView('name-setup') }} className="text-slate-300 underline ml-1 text-[10px]">เปลี่ยน</button></p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="text-white text-sm font-bold px-4 py-2.5 rounded-xl"
            style={{ background: 'linear-gradient(135deg,#C72C41,#801336)' }}>
            + สร้างรอบ
          </button>
        </div>

        {loadingSess ? (
          <div className="text-center py-12 text-slate-400 text-sm">กำลังโหลด…</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🗂️</div>
            <p className="text-slate-500 font-medium">ยังไม่มีรอบนับที่เปิดอยู่</p>
            <p className="text-sm text-slate-400 mt-1">กด "สร้างรอบ" เพื่อเริ่มนับสต๊อก</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">รอบที่กำลังนับ</p>
            {sessions.map(s => (
              <div key={s.id} className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-700">{s.name}</div>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">กำลังนับ</span>
                    {s.blind && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">🙈 Blind</span>}
                    {s.category_filter?.length > 0 && <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">📂 {s.category_filter.join(', ')}</span>}
                    <span className="text-[10px] text-slate-400">{fmtDate(s.created_at)}</span>
                  </div>
                </div>
                <button onClick={() => joinSession(s)}
                  className="text-brand border-2 border-brand text-sm font-bold px-4 py-2 rounded-xl active:bg-brand/5 flex-shrink-0">
                  เข้าร่วม
                </button>
              </div>
            ))}
          </div>
        )}

        <button onClick={loadSessions} className="mt-4 w-full text-sm text-slate-400 py-2 text-center">↻ รีเฟรช</button>

        {/* Create session modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.5)' }}
            onClick={e => { if (e.target === e.currentTarget) setShowCreate(false) }}>
            <div className="w-full max-w-2xl mx-auto bg-white rounded-t-3xl shadow-2xl p-5 pb-8">
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
              <h2 className="text-lg font-bold text-slate-800 mb-4">สร้างรอบนับสต๊อก</h2>

              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">ชื่อรอบ</label>
              <input autoFocus value={newSName} onChange={e => setNewSName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createSession()}
                placeholder="เช่น นับสต๊อก สิงหาคม 2569"
                className="w-full border-2 border-slate-200 focus:border-brand rounded-xl px-4 py-3 text-base mb-4 outline-none mt-1"
              />

              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">หมวดหมู่/โซน (เลือกได้หลายอย่าง)</label>
              <div className="flex flex-wrap gap-2 mt-2 mb-4">
                {categories.map(c => (
                  <button key={c.id} onClick={() => setNewCats(prev => prev.includes(c.name) ? prev.filter(x => x !== c.name) : [...prev, c.name])}
                    className="text-sm px-3 py-1.5 rounded-full border-2 font-medium transition-all"
                    style={newCats.includes(c.name) ? { borderColor: '#C72C41', background: '#C72C41', color: '#fff' } : { borderColor: '#e2e8f0', background: '#f8fafc', color: '#64748b' }}>
                    {c.name}
                  </button>
                ))}
                {categories.length === 0 && <span className="text-xs text-slate-400">ไม่มีหมวดหมู่</span>}
              </div>
              {newCats.length === 0 && <p className="text-xs text-slate-400 mb-4 -mt-2">ไม่เลือก = นับทุกหมวด</p>}

              <div className="flex items-center justify-between mb-5 px-1">
                <div>
                  <div className="font-semibold text-slate-700 text-sm">🙈 Blind Count</div>
                  <div className="text-xs text-slate-400">ซ่อนตัวเลขระบบระหว่างนับ</div>
                </div>
                <button onClick={() => setNewBlind(v => !v)}
                  className="w-12 h-6 rounded-full transition-all relative"
                  style={{ background: newBlind ? '#C72C41' : '#e2e8f0' }}>
                  <span className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all" style={{ left: newBlind ? '26px' : '4px' }} />
                </button>
              </div>

              <button onClick={createSession} disabled={!newSName.trim() || creating}
                className="w-full py-4 rounded-2xl text-white font-bold text-base disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#C72C41,#801336)' }}>
                {creating ? 'กำลังสร้าง…' : '🚀 สร้างและเริ่มนับ'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── COUNTING VIEW ────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto pb-28">

      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-100 px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => { setView('sessions'); loadSessions() }}
            className="text-slate-400 text-xl leading-none pr-1">‹</button>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-slate-700 truncate">{session?.name}</div>
            <div className="text-[11px] text-slate-400">ผู้นับ: <span className="font-semibold text-brand">{myName}</span></div>
          </div>
          <button onClick={() => setBlind(v => !v)}
            className="text-xs px-2.5 py-1.5 rounded-lg border font-medium"
            style={blind ? { background: '#fef3c7', borderColor: '#f59e0b', color: '#92400e' } : { background: '#f8fafc', borderColor: '#e2e8f0', color: '#94a3b8' }}>
            {blind ? '🙈 Blind' : '👁️ ปกติ'}
          </button>
          <button onClick={() => setShowCatPanel(v => !v)}
            className="text-xs px-2.5 py-1.5 rounded-lg border font-medium"
            style={catFilter.length ? { background: '#dbeafe', borderColor: '#93c5fd', color: '#1e40af' } : { background: '#f8fafc', borderColor: '#e2e8f0', color: '#94a3b8' }}>
            📂 {catFilter.length ? catFilter[0] + (catFilter.length > 1 ? ` +${catFilter.length - 1}` : '') : 'ทุกโซน'}
          </button>
        </div>

        {/* Cat filter panel */}
        {showCatPanel && (
          <div className="flex flex-wrap gap-1.5 pt-2 pb-1">
            <button onClick={() => { setCatFilter([]); catFilterRef.current = [] }}
              className="text-xs px-3 py-1 rounded-full border-2 font-medium"
              style={catFilter.length === 0 ? { borderColor: '#C72C41', background: '#C72C41', color: '#fff' } : { borderColor: '#e2e8f0', color: '#64748b' }}>
              ทุกหมวด
            </button>
            {categories.map(c => (
              <button key={c.id} onClick={() => {
                const next = catFilter.includes(c.name) ? catFilter.filter(x => x !== c.name) : [...catFilter, c.name]
                setCatFilter(next); catFilterRef.current = next
              }}
                className="text-xs px-3 py-1 rounded-full border-2 font-medium"
                style={catFilter.includes(c.name) ? { borderColor: '#C72C41', background: '#C72C41', color: '#fff' } : { borderColor: '#e2e8f0', color: '#64748b' }}>
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Camera */}
      {cameraOpen && (
        <div className="relative overflow-hidden flex-shrink-0 bg-black" style={{ height: 260 }}>
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" style={{ display: hasBD ? 'block' : 'none' }} />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div id="stock-qr-reader" className="w-full h-full" style={{ display: hasBD ? 'none' : 'block' }} />
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center px-4 pt-3 pointer-events-none" style={{ background: 'linear-gradient(to bottom,rgba(0,0,0,0.6),transparent)' }}>
            <span className="text-white text-sm font-medium">📷 จ่อกล้องที่บาร์โค้ด</span>
          </div>
          <button onClick={closeCamera} className="absolute top-3 right-4 z-20 text-white text-xl font-bold w-8 h-8 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 20 }}>✕</button>
          {camDbg ? <div className="absolute bottom-10 left-2 right-2 z-10 bg-black/70 text-white text-[10px] px-2 py-1 rounded">{camDbg}</div> : null}
          {lastMsg && (
            <div className={`absolute bottom-3 left-3 right-3 z-10 py-2.5 px-4 rounded-2xl text-center font-bold text-sm shadow-lg ${lastMsg.ok ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>{lastMsg.text}</div>
          )}
        </div>
      )}

      <div className="px-4 pt-3">
        {/* Scanner input */}
        <div className="flex gap-2 mb-2">
          <input ref={inputRef} type="text" value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            onKeyDown={handleInputKey}
            onBlur={() => !cameraOpen && setTimeout(() => inputRef.current?.focus(), 80)}
            placeholder="สแกนหรือพิมพ์บาร์โค้ด…"
            className="flex-1 border-2 border-brand rounded-xl px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-brand/50"
          />
          <button onClick={cameraOpen ? closeCamera : openCamera}
            className="text-white rounded-xl px-4 py-3 text-2xl flex-shrink-0 active:opacity-80"
            style={{ background: cameraOpen ? '#64748b' : '#C72C41' }}>
            {cameraOpen ? '⏹' : '📷'}
          </button>
        </div>

        {/* Flash message */}
        {!cameraOpen && lastMsg && (
          <div className={`text-base mb-2 px-4 py-2.5 rounded-xl font-medium ${lastMsg.ok ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>{lastMsg.text}</div>
        )}

        {/* Name search */}
        <div className="relative mb-3">
          <input type="text" value={nameSearch} onChange={e => handleNameSearch(e.target.value)}
            onBlur={() => setTimeout(() => setNameSuggestions([]), 200)}
            placeholder="🔍 ค้นหาชื่อสินค้า"
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand bg-slate-50"
          />
          {nameSuggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-40 max-h-64 overflow-y-auto">
              {nameSuggestions.map(p => (
                <li key={p.id} onMouseDown={() => pickSuggestion(p)}
                  className="px-4 py-2.5 flex justify-between items-center hover:bg-brand/5 cursor-pointer border-b border-slate-50 last:border-0">
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">{p.name}</div>
                    <div className="text-xs text-slate-400">{p.barcode || '—'} {p.categories?.name ? `· ${p.categories.name}` : ''}</div>
                  </div>
                  {!blind && <div className="text-xs text-slate-500 flex-shrink-0">สต็อก {fmt(p.stock)}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-white rounded-xl p-3 text-center shadow-sm">
            <div className="text-xl font-bold text-slate-700">{countsList.length}</div>
            <div className="text-[11px] text-slate-500">SKU</div>
          </div>
          <div className="bg-white rounded-xl p-3 text-center shadow-sm">
            <div className="text-xl font-bold text-slate-700">{fmt(totalItems)}</div>
            <div className="text-[11px] text-slate-500">ชิ้นรวม</div>
          </div>
          <div className={`rounded-xl p-3 text-center shadow-sm ${diffCount > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
            <div className={`text-xl font-bold ${diffCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{diffCount}</div>
            <div className="text-[11px] text-slate-500">ต่างระบบ</div>
          </div>
        </div>

        {/* Items */}
        {countsList.length === 0 ? (
          <div className="text-center text-slate-400 py-12">
            <div className="text-4xl mb-3">📷</div>
            <p className="text-sm">สแกนบาร์โค้ดหรือค้นหาชื่อสินค้าเพื่อเริ่มนับ</p>
          </div>
        ) : (
          <div className="space-y-2">
            {countsList.map(c => {
              const diff = c.total - c.system
              return (
                <div key={c.pid} className="bg-white rounded-xl p-3.5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-700 text-sm leading-tight">{c.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{c.barcode || '—'}</div>
                      {!blind && (
                        <div className="text-xs text-slate-400 mt-1">ระบบ: <span className="font-medium text-slate-600">{fmt(c.system)}</span> {c.unit}</div>
                      )}
                      {c.others.length > 0 && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {c.others.map(([name, n]) => (
                            <span key={name} className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">{name}: {n}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => adjustMyCount(c.pid, -1)}
                        className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-lg flex items-center justify-center active:scale-95">−</button>
                      <div className="text-center w-12">
                        <div className="text-xl font-bold text-slate-700">{c.total}</div>
                        {c.myCount !== c.total && <div className="text-[10px] text-slate-400">ฉัน {c.myCount}</div>}
                      </div>
                      <button onClick={() => adjustMyCount(c.pid, 1)}
                        className="w-8 h-8 rounded-full font-bold text-lg flex items-center justify-center active:scale-95"
                        style={{ background: 'rgba(199,44,65,0.1)', color: '#C72C41' }}>+</button>
                    </div>
                    <div className={`text-sm font-bold w-8 text-right flex-shrink-0 ${diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                      {!blind ? (diff === 0 ? '✓' : diff > 0 ? `+${diff}` : `${diff}`) : '—'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {countsList.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 px-4" style={{ paddingBottom: 'max(env(safe-area-inset-bottom),12px)', background: 'linear-gradient(to top,#f8fafc 80%,transparent)' }}>
          <div className="max-w-2xl mx-auto pb-3">
            <button onClick={openApplyModal}
              className="w-full py-4 rounded-2xl text-base font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#C72C41,#801336)' }}>
              ✅ ปรับสต๊อก {countsList.length} SKU ({fmt(allCount)} ชิ้น)
            </button>
          </div>
        </div>
      )}

      {/* Apply modal */}
      {showApply && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowApply(false) }}>
          <div className="w-full max-w-2xl mx-auto bg-white rounded-t-3xl shadow-2xl max-h-[92vh] flex flex-col">
            <div className="px-5 pt-5 pb-3 flex-shrink-0">
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
              <h2 className="text-lg font-bold text-slate-800 mb-3">ยืนยันปรับสต๊อก</h2>
              <div className="flex gap-2 mb-1">
                {[{ key: 'add', label: '+ เพิ่ม' }, { key: 'reduce', label: '− ลด' }, { key: 'reset', label: '↺ ตั้งค่าใหม่' }].map(m => (
                  <button key={m.key} onClick={() => setApplyMode(m.key)}
                    className="flex-1 py-2 rounded-xl text-sm font-bold transition-all"
                    style={applyMode === m.key ? { background: '#C72C41', color: '#fff' } : { background: '#f1f5f9', color: '#64748b' }}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 text-center mt-1.5">
                {applyMode === 'add' && 'สต๊อกใหม่ = เดิม + นับได้'}
                {applyMode === 'reduce' && 'สต๊อกใหม่ = เดิม − นับได้'}
                {applyMode === 'reset' && 'สต๊อกใหม่ = จำนวนที่นับได้ (ตั้งค่าใหม่)'}
              </p>
            </div>
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
                          <div className="font-medium text-slate-700 leading-tight text-[13px]">{item.name}</div>
                          {item.contributors.length > 1 && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {item.contributors.map(([n, c]) => `${n}:${c}`).join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="py-2 text-right text-slate-500">{fmt(item.stockBefore)}</td>
                        <td className="py-2 text-right text-slate-500">{fmt(item.counted)}</td>
                        <td className="py-2 text-right font-bold">
                          <span className={diff > 0 ? 'text-blue-600' : diff < 0 ? 'text-red-600' : 'text-green-600'}>{fmt(after)}</span>
                          <div className="text-[10px] font-normal text-slate-400">{diff === 0 ? '±0' : diff > 0 ? `+${fmt(diff)}` : fmt(diff)}</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-4 flex-shrink-0 border-t border-slate-100">
              <button onClick={applyToStock} disabled={applying}
                className="w-full py-4 rounded-2xl text-base font-bold text-white disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#C72C41,#801336)' }}>
                {applying ? 'กำลังบันทึก…' : `ยืนยัน ปรับสต๊อก ${applyPreview.length} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
