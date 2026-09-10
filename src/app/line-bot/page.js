'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'

const KEYS = ['line_bot_enabled', 'line_bot_name', 'line_bot_persona', 'line_bot_silent_keywords']

const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function LineBotPage() {
  const auth = useAuth()
  const isAdmin = auth?.role === 'admin'

  const [cfg, setCfg] = useState({
    line_bot_enabled: 'true',
    line_bot_name: 'น้องมิน',
    line_bot_persona: 'ผู้ช่วยขายของร้าน ตอบภาษาไทยสั้นกระชับ เป็นกันเอง ใช้ครับ/ค่ะ',
    line_bot_silent_keywords: 'ซ่อม,ติดตามงาน,คุยกับเจ้าของ,คุยกับแอดมิน',
  })
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [convs, setConvs]         = useState([])
  const [convLoading, setConvLoading] = useState(true)
  const [lineNames, setLineNames]     = useState({})   // { userId: displayName }

  // ── Card sender state ──
  const [cardModal, setCardModal]     = useState(null)   // { userId }
  const [cardItems, setCardItems]     = useState([])     // [{ id, name, price, unit, qty }]
  const [cardNote, setCardNote]       = useState('')
  const [prodSearch, setProdSearch]   = useState('')
  const [searchRes, setSearchRes]     = useState([])
  const [searching, setSearching]     = useState(false)
  const [sending, setSending]         = useState(false)
  const [sendOk, setSendOk]          = useState(false)

  // ── Manual reply state ──
  const [replyTexts, setReplyTexts]   = useState({})   // { userId: text }
  const [replySending, setReplySending] = useState({}) // { userId: bool }

  useEffect(() => { load(); loadConvs() }, [])

  async function load() {
    const { data } = await supabase.from('settings').select('key,value').in('key', KEYS)
    if (data?.length) {
      const map = Object.fromEntries(data.map(r => [r.key, r.value]))
      setCfg(prev => ({ ...prev, ...map }))
    }
  }

  async function loadConvs() {
    setConvLoading(true)
    const { data } = await supabase
      .from('line_conversations')
      .select('id,line_user_id,role,content,created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    const rows = data || []
    setConvs(rows)
    setConvLoading(false)

    const uids = [...new Set(rows.map(r => r.line_user_id))]
    if (uids.length) {
      fetch('/api/line-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: uids }),
      }).then(r => r.json()).then(map => setLineNames(map)).catch(() => {})
    }
  }

  async function save() {
    setSaving(true)
    try {
      await Promise.all(
        KEYS.map(key => supabase.from('settings').upsert({ key, value: cfg[key] ?? '' }, { onConflict: 'key' }))
      )
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { alert('ข้อผิดพลาด: ' + e.message) } finally { setSaving(false) }
  }

  // ── Product search ──
  const searchProducts = useCallback(async (q) => {
    if (!q.trim()) { setSearchRes([]); return }
    setSearching(true)
    const words = q.trim().split(/\s+/).filter(w => w.length >= 1)
    const orParts = words.flatMap(w => [`name.ilike.%${w}%`, `search_tags.ilike.%${w}%`])
    const { data } = await supabase.from('products')
      .select('id,name,price,online_price,unit')
      .eq('active', true).or(orParts.join(','))
      .order('stock', { ascending: false }).limit(8)
    setSearchRes(data || [])
    setSearching(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => searchProducts(prodSearch), 300)
    return () => clearTimeout(t)
  }, [prodSearch, searchProducts])

  function addItem(p) {
    setCardItems(prev => {
      const ex = prev.find(i => i.id === p.id)
      if (ex) return prev.map(i => i.id === p.id ? { ...i, qty: i.qty + 1 } : i)
      const price = p.online_price != null ? p.online_price : p.price
      return [...prev, { id: p.id, name: p.name, price, unit: p.unit || 'ชิ้น', qty: 1 }]
    })
  }

  function setQty(id, qty) {
    if (qty <= 0) { setCardItems(prev => prev.filter(i => i.id !== id)); return }
    setCardItems(prev => prev.map(i => i.id === id ? { ...i, qty } : i))
  }

  function updateItem(id, field, value) {
    setCardItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  function openModal(userId) {
    setCardModal({ userId })
    setCardItems([])
    setCardNote('')
    setProdSearch('')
    setSearchRes([])
    setSendOk(false)
  }

  async function sendCard() {
    if (!cardItems.length) return
    setSending(true)
    try {
      const res = await fetch('/api/line-push-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineUserId: cardModal.userId, items: cardItems, note: cardNote }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'ส่งไม่สำเร็จ')
      setSendOk(true)
      setTimeout(() => { setCardModal(null); setSendOk(false); loadConvs() }, 1500)
    } catch (e) { alert('ส่งไม่สำเร็จ: ' + e.message) } finally { setSending(false) }
  }

  async function sendReply(userId) {
    const text = (replyTexts[userId] || '').trim()
    if (!text) return
    setReplySending(p => ({ ...p, [userId]: true }))
    try {
      const res = await fetch('/api/line-push-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineUserId: userId, manualText: text }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'ส่งไม่สำเร็จ')
      setReplyTexts(p => ({ ...p, [userId]: '' }))
      await loadConvs()
    } catch (e) { alert('ส่งไม่สำเร็จ: ' + e.message) }
    finally { setReplySending(p => ({ ...p, [userId]: false })) }
  }

  const STATE_PREFIXES = ['__awaiting_delivery__', '__awaiting_repair__', '__awaiting_order_info__', '[ORDER_DATA]']
  const isStateMsg = content => STATE_PREFIXES.some(p => content?.startsWith(p))

  const visibleConvs = convs.filter(c => !isStateMsg(c.content))

  const grouped = visibleConvs.reduce((acc, c) => {
    if (!acc[c.line_user_id]) acc[c.line_user_id] = []
    acc[c.line_user_id].push(c)
    return acc
  }, {})

  const fmtTime = ts => new Date(ts).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })

  const cardTotal = cardItems.reduce((s, i) => s + i.price * i.qty, 0)

  return (
    <div className="page max-w-2xl mx-auto">
      <h1 className="font-heading font-bold text-xl text-slate-800 mb-6">💬 ตั้งค่าบอท LINE</h1>

      {isAdmin && (<>
        {/* Toggle เปิด/ปิด */}
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-slate-800">สถานะบอท</p>
            <p className="text-sm text-slate-500 mt-0.5">เปิด = บอทตอบลูกค้าอัตโนมัติ</p>
          </div>
          <button
            onClick={() => setCfg(p => ({ ...p, line_bot_enabled: p.line_bot_enabled === 'true' ? 'false' : 'true' }))}
            className={`relative w-14 h-7 rounded-full transition-colors ${cfg.line_bot_enabled === 'true' ? 'bg-green-500' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${cfg.line_bot_enabled === 'true' ? 'left-7' : 'left-0.5'}`} />
          </button>
        </div>

        {/* ตั้งค่าบอท */}
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4 space-y-4">
          <h2 className="font-semibold text-slate-700">ตัวตนบอท</h2>
          <div>
            <label className="text-xs text-slate-500 block mb-1">ชื่อบอท</label>
            <input value={cfg.line_bot_name} onChange={e => setCfg(p => ({ ...p, line_bot_name: e.target.value }))}
              className="input-field text-sm w-full" placeholder="เช่น น้องมิน, น้องโอ, แอดมิน" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">บุคลิก / วิธีตอบ (system prompt)</label>
            <textarea value={cfg.line_bot_persona} onChange={e => setCfg(p => ({ ...p, line_bot_persona: e.target.value }))}
              rows={4} className="input-field text-sm w-full resize-none"
              placeholder="เช่น ผู้ช่วยขายของร้าน ตอบภาษาไทยสั้นกระชับ เป็นกันเอง ใช้ค่ะ" />
            <p className="text-xs text-slate-400 mt-1">AI จะตอบตามบุคลิกที่กำหนด</p>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">คำที่ให้บอทเงียบ (คั่นด้วยจุลภาค)</label>
            <input value={cfg.line_bot_silent_keywords} onChange={e => setCfg(p => ({ ...p, line_bot_silent_keywords: e.target.value }))}
              className="input-field text-sm w-full" placeholder="เช่น ซ่อม,ติดตามงาน,คุยกับเจ้าของ" />
            <p className="text-xs text-slate-400 mt-1">ถ้าข้อความลูกค้ามีคำเหล่านี้ บอทจะไม่ตอบ</p>
          </div>
        </div>

        <button onClick={save} disabled={saving} className="w-full btn-primary py-3 mb-8 disabled:opacity-50">
          {saved ? '✅ บันทึกแล้ว' : saving ? 'กำลังบันทึก...' : '💾 บันทึกการตั้งค่า'}
        </button>
      </>)}

      {/* ประวัติสนทนา */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100">
          <h2 className="font-semibold text-slate-700">ประวัติสนทนา</h2>
          <button onClick={loadConvs} className="text-xs text-slate-400 hover:text-slate-600">🔄 รีเฟรช</button>
        </div>

        {convLoading ? (
          <p className="text-center text-slate-400 text-sm py-8">กำลังโหลด...</p>
        ) : Object.keys(grouped).length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-8">ยังไม่มีประวัติสนทนา</p>
        ) : (
          <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            {Object.entries(grouped).map(([userId, msgs]) => (
              <details key={userId} className="group">
                <summary className="px-5 py-3 flex items-center gap-3 cursor-pointer list-none hover:bg-slate-50">
                  <span className="text-2xl">👤</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{lineNames[userId] || <span className="font-mono text-xs text-slate-400">{userId}</span>}</p>
                    <p className="text-sm text-slate-500 truncate">{msgs.filter(m => !isStateMsg(m.content)).at(-1)?.content}</p>
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0">{msgs.length} ข้อความ</span>
                  <span className="text-slate-300 group-open:rotate-90 transition-transform">▶</span>
                </summary>
                <div className="px-5 pb-3 space-y-2 bg-slate-50">
                  {[...msgs].reverse().map(m => (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${m.role === 'user' ? 'bg-white border border-slate-200 text-slate-700' : 'text-white'}`}
                        style={m.role === 'assistant' ? { background: '#06C755' } : {}}>
                        <p className="whitespace-pre-wrap">{m.content}</p>
                        <p className={`text-[10px] mt-0.5 ${m.role === 'user' ? 'text-slate-400' : 'text-green-100'}`}>{fmtTime(m.created_at)}</p>
                      </div>
                    </div>
                  ))}

                  {/* Quick chips */}
                  <div className="pt-2 flex flex-wrap gap-1.5">
                    {[
                      { label: '👋 ทักทาย', text: 'สวัสดีครับ มีอะไรให้ช่วยได้เลยนะครับ 🙏' },
                      { label: '✅ รับออเดอร์', text: 'รับออเดอร์แล้วครับ 🎉 ทางร้านจะรีบจัดเตรียมให้นะครับ' },
                      { label: '🚚 กำลังจัดส่ง', text: 'กำลังจัดส่งแล้วครับ 🚚 รอรับได้เลยนะครับ' },
                      { label: '💳 แจ้งชำระ', text: 'กรุณาโอนเงินมาที่\nธนาคาร: \nชื่อบัญชี: \nเลขที่บัญชี: \nแล้วส่งสลิปมาให้ด้วยนะครับ 🙏' },
                      { label: '📞 โทรกลับ', text: 'ขออนุญาตโทรกลับหาลูกค้านะครับ 📞' },
                      { label: '🙏 ขอบคุณ', text: 'ขอบคุณมากครับ หากมีอะไรสงสัยเพิ่มเติมถามได้เลยนะครับ 😊' },
                    ].map(chip => (
                      <button
                        key={chip.label}
                        onClick={() => setReplyTexts(p => ({ ...p, [userId]: chip.text }))}
                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-95 transition-all whitespace-nowrap"
                      >
                        {chip.label}
                      </button>
                    ))}
                    <button
                      onClick={() => openModal(userId)}
                      className="px-2.5 py-1 rounded-full text-xs font-semibold text-white active:scale-95 transition-all whitespace-nowrap"
                      style={{ background: '#C72C41' }}
                    >
                      📦 ส่งการ์ดสินค้า
                    </button>
                  </div>

                  {/* Reply box */}
                  <div className="flex gap-2 items-end">
                    <textarea
                      value={replyTexts[userId] || ''}
                      onChange={e => setReplyTexts(p => ({ ...p, [userId]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(userId) } }}
                      placeholder="พิมพ์ตอบกลับ... (Enter ส่ง, Shift+Enter ขึ้นบรรทัด)"
                      rows={2}
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-slate-400 bg-white"
                    />
                    <button
                      onClick={() => sendReply(userId)}
                      disabled={replySending[userId] || !replyTexts[userId]?.trim()}
                      className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 active:scale-95 transition-all flex-shrink-0"
                      style={{ background: '#06C755' }}
                    >
                      {replySending[userId] ? '...' : '➤ ส่ง'}
                    </button>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      {/* ── Modal ส่งการ์ดสินค้า ── */}
      {cardModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) setCardModal(null) }}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <div>
                <p className="font-bold text-slate-800">📦 ส่งการ์ดสินค้า</p>
                <p className="text-sm text-slate-600">{lineNames[cardModal.userId] || '—'}</p>
                <p className="text-xs text-slate-400 font-mono truncate max-w-[240px]">{cardModal.userId}</p>
              </div>
              <button onClick={() => setCardModal(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              {/* ค้นหาสินค้า */}
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1.5">🔍 ค้นหาสินค้า</label>
                <input
                  value={prodSearch}
                  onChange={e => setProdSearch(e.target.value)}
                  placeholder="พิมชื่อสินค้า..."
                  className="input-field text-sm w-full"
                  autoFocus
                />
                {searching && <p className="text-xs text-slate-400 mt-1">กำลังค้นหา...</p>}
                {searchRes.length > 0 && (
                  <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden">
                    {searchRes.map(p => {
                      const price = p.online_price != null ? p.online_price : p.price
                      const inList = cardItems.find(i => i.id === p.id)
                      return (
                        <button key={p.id} onClick={() => addItem(p)}
                          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors text-left">
                          <div>
                            <p className="text-sm font-medium text-slate-800">{p.name}</p>
                            <p className="text-xs text-slate-500">฿{fmt(price)}/{p.unit || 'ชิ้น'}</p>
                          </div>
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${inList ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                            {inList ? `✓ x${inList.qty}` : '+ เพิ่ม'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* รายการที่เลือก */}
              {cardItems.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1.5">🛒 รายการที่เลือก</label>
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    {cardItems.map(item => (
                      <div key={item.id} className="px-4 py-3 border-b border-slate-100 last:border-0">
                        <input
                          value={item.name}
                          onChange={e => updateItem(item.id, 'name', e.target.value)}
                          className="text-sm font-medium text-slate-800 w-full border-0 border-b border-dashed border-slate-200 bg-transparent focus:outline-none focus:border-slate-400 mb-1.5 pb-0.5"
                        />
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">฿</span>
                          <input
                            type="number"
                            value={item.price}
                            onChange={e => updateItem(item.id, 'price', Number(e.target.value) || 0)}
                            className="text-xs text-slate-500 w-20 border-0 border-b border-dashed border-slate-200 bg-transparent focus:outline-none focus:border-slate-400"
                          />
                          <span className="text-xs text-slate-400">× {item.qty} = ฿{fmt(item.price * item.qty)}</span>
                          <div className="flex items-center gap-1.5 ml-auto">
                            <button onClick={() => setQty(item.id, item.qty - 1)}
                              className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200 flex items-center justify-center">−</button>
                            <span className="w-6 text-center text-sm font-semibold">{item.qty}</span>
                            <button onClick={() => setQty(item.id, item.qty + 1)}
                              className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200 flex items-center justify-center">+</button>
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="px-4 py-3 bg-slate-50 flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-700">รวมทั้งหมด</span>
                      <span className="text-lg font-bold" style={{ color: '#C72C41' }}>฿{fmt(cardTotal)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* หมายเหตุ */}
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1.5">💬 หมายเหตุ (ถ้ามี)</label>
                <input value={cardNote} onChange={e => setCardNote(e.target.value)}
                  placeholder="เช่น ส่งพรุ่งนี้, ต้องการรีบ..."
                  className="input-field text-sm w-full" />
              </div>

              {/* Preview */}
              {cardItems.length > 0 && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <p className="text-xs font-semibold text-slate-500 mb-2">👀 ลูกค้าจะเห็น</p>
                  <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-slate-200">
                    <div className="px-4 py-3" style={{ background: '#C72C41' }}>
                      <p className="text-white text-sm font-bold">📋 รายการสินค้าจากร้าน</p>
                    </div>
                    <div className="px-4 py-3 space-y-1.5">
                      {cardItems.map(item => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span className="text-slate-700">{item.name} ×{item.qty}</span>
                          <span className="font-semibold" style={{ color: '#C72C41' }}>฿{fmt(item.price * item.qty)}</span>
                        </div>
                      ))}
                      <div className="border-t border-slate-100 pt-2 flex justify-between font-bold">
                        <span className="text-slate-800">รวม</span>
                        <span style={{ color: '#C72C41' }}>฿{fmt(cardTotal)}</span>
                      </div>
                      {cardNote && <p className="text-xs text-slate-500 pt-1">💬 {cardNote}</p>}
                    </div>
                    <div className="px-4 pb-3">
                      <div className="w-full py-2 rounded-lg text-white text-sm text-center font-semibold" style={{ background: '#C72C41' }}>
                        ✅ ยืนยันสั่งซื้อ
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-100">
              <button
                onClick={sendCard}
                disabled={!cardItems.length || sending || sendOk}
                className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all disabled:opacity-40 active:scale-95"
                style={{ background: sendOk ? '#22c55e' : '#C72C41' }}
              >
                {sendOk ? '✅ ส่งแล้ว!' : sending ? 'กำลังส่ง...' : `📤 ส่งการ์ดให้ลูกค้า (฿${fmt(cardTotal)})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
