'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const KEYS = ['line_bot_enabled', 'line_bot_name', 'line_bot_persona', 'line_bot_silent_keywords']

export default function LineBotPage() {
  const [cfg, setCfg]       = useState({
    line_bot_enabled: 'true',
    line_bot_name: 'น้องมิน',
    line_bot_persona: 'ผู้ช่วยขายของร้าน ตอบภาษาไทยสั้นกระชับ เป็นกันเอง ใช้ครับ/ค่ะ',
    line_bot_silent_keywords: 'ซ่อม,ติดตามงาน,คุยกับเจ้าของ,คุยกับแอดมิน',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [convs, setConvs]   = useState([])
  const [convLoading, setConvLoading] = useState(true)

  useEffect(() => {
    load()
    loadConvs()
  }, [])

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
    setConvs(data || [])
    setConvLoading(false)
  }

  async function save() {
    setSaving(true)
    try {
      await Promise.all(
        KEYS.map(key =>
          supabase.from('settings').upsert({ key, value: cfg[key] ?? '' }, { onConflict: 'key' })
        )
      )
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) { alert('ข้อผิดพลาด: ' + e.message) } finally { setSaving(false) }
  }

  // จัดกลุ่ม conversations ตาม line_user_id
  const grouped = convs.reduce((acc, c) => {
    if (!acc[c.line_user_id]) acc[c.line_user_id] = []
    acc[c.line_user_id].push(c)
    return acc
  }, {})

  const fmtTime = ts => new Date(ts).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="page max-w-2xl mx-auto">
      <h1 className="font-heading font-bold text-xl text-slate-800 mb-6">💬 ตั้งค่าบอท LINE</h1>

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
          <input
            value={cfg.line_bot_name}
            onChange={e => setCfg(p => ({ ...p, line_bot_name: e.target.value }))}
            className="input-field text-sm w-full"
            placeholder="เช่น น้องมิน, น้องโอ, แอดมิน"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 block mb-1">บุคลิก / วิธีตอบ (system prompt)</label>
          <textarea
            value={cfg.line_bot_persona}
            onChange={e => setCfg(p => ({ ...p, line_bot_persona: e.target.value }))}
            rows={4}
            className="input-field text-sm w-full resize-none"
            placeholder="เช่น ผู้ช่วยขายของร้าน ตอบภาษาไทยสั้นกระชับ เป็นกันเอง ใช้ค่ะ"
          />
          <p className="text-xs text-slate-400 mt-1">AI จะตอบตามบุคลิกที่กำหนด</p>
        </div>

        <div>
          <label className="text-xs text-slate-500 block mb-1">คำที่ให้บอทเงียบ (คั่นด้วยจุลภาค)</label>
          <input
            value={cfg.line_bot_silent_keywords}
            onChange={e => setCfg(p => ({ ...p, line_bot_silent_keywords: e.target.value }))}
            className="input-field text-sm w-full"
            placeholder="เช่น ซ่อม,ติดตามงาน,คุยกับเจ้าของ"
          />
          <p className="text-xs text-slate-400 mt-1">ถ้าข้อความลูกค้ามีคำเหล่านี้ บอทจะไม่ตอบ (รอแอดมินตอบเอง)</p>
        </div>
      </div>

      {/* บันทึก */}
      <button
        onClick={save}
        disabled={saving}
        className="w-full btn-primary py-3 mb-8 disabled:opacity-50"
      >
        {saved ? '✅ บันทึกแล้ว' : saving ? 'กำลังบันทึก...' : '💾 บันทึกการตั้งค่า'}
      </button>

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
          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {Object.entries(grouped).map(([userId, msgs]) => (
              <details key={userId} className="group">
                <summary className="px-5 py-3 flex items-center gap-3 cursor-pointer list-none hover:bg-slate-50">
                  <span className="text-2xl">👤</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-400 font-mono truncate">{userId}</p>
                    <p className="text-sm text-slate-600 truncate">{msgs[msgs.length-1]?.content}</p>
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0">{msgs.length} ข้อความ</span>
                  <span className="text-slate-300 group-open:rotate-90 transition-transform">▶</span>
                </summary>
                <div className="px-5 pb-4 space-y-2 bg-slate-50">
                  {[...msgs].reverse().map(m => (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${m.role === 'user' ? 'bg-white border border-slate-200 text-slate-700' : 'text-white'}`}
                        style={m.role === 'assistant' ? { background: '#06C755' } : {}}>
                        <p>{m.content}</p>
                        <p className={`text-[10px] mt-0.5 ${m.role === 'user' ? 'text-slate-400' : 'text-green-100'}`}>{fmtTime(m.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
