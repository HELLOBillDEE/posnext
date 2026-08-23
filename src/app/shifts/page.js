'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, fmtDT } from '@/lib/utils'

export default function ShiftsPage() {
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)
  const [tab, setTab] = useState('all') // 'all' | 'pos1' | 'pos2'

  useEffect(() => { loadShifts() }, [])

  async function loadShifts() {
    setLoading(true)
    const { data } = await supabase.from('shifts')
      .select('*').order('opened_at', { ascending: false }).limit(100)
    setShifts(data || [])
    setLoading(false)
  }

  const normalize = id => (id || '').toLowerCase()

  const filtered = tab === 'all' ? shifts
    : tab === 'pos1' ? shifts.filter(s => normalize(s.terminal_id) === 'pos1')
    : shifts.filter(s => normalize(s.terminal_id) === 'pos2')

  const openShifts = filtered.filter(s => s.status === 'open')
  const closedShifts = filtered.filter(s => s.status === 'closed')

  const termColor = id => {
    const n = normalize(id)
    if (n === 'pos1') return 'bg-blue-100 text-blue-700'
    if (n === 'pos2') return 'bg-purple-100 text-purple-700'
    return 'bg-slate-100 text-slate-500'
  }

  return (
    <div className="max-w-3xl mx-auto px-3 py-4">
      <h1 className="font-heading font-bold text-xl text-brand mb-4">🕐 ประวัติกะ</h1>

      {/* Tab filter */}
      <div className="flex gap-2 mb-4">
        {[['all','ทั้งหมด'],['pos1','POS1'],['pos2','POS2']].map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              tab === v ? 'bg-brand text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Open shift banners */}
      {openShifts.map(s => (
        <div key={s.id} className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-3 flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-emerald-700 text-sm">🟢 กะปัจจุบัน</p>
              {s.terminal_id && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${termColor(s.terminal_id)}`}>
                  {s.terminal_id.toUpperCase()}
                </span>
              )}
            </div>
            <p className="text-xs text-emerald-600 mt-0.5">เปิดเมื่อ {fmtDT(s.opened_at)}</p>
            <p className="text-xs text-emerald-600">เงินเริ่มต้น ฿{fmt(s.opening_cash)}</p>
          </div>
          <a href="/pos" className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold">
            ไปหน้าขาย →
          </a>
        </div>
      ))}

      {loading && <div className="text-center py-12 text-slate-400 text-sm">กำลังโหลด...</div>}

      {!loading && closedShifts.length === 0 && openShifts.length === 0 && (
        <div className="text-center py-16 text-slate-400 text-sm">
          <p className="text-4xl mb-3">🕐</p>
          <p>ยังไม่มีประวัติกะ</p>
          <a href="/pos" className="mt-3 block text-brand text-sm underline">ไปเปิดกะที่หน้าขาย →</a>
        </div>
      )}

      <div className="space-y-3">
        {closedShifts.map(s => (
          <div key={s.id} onClick={() => setDetail(detail?.id === s.id ? null : s)}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer hover:border-brand/30 transition-colors">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-semibold text-slate-700 text-sm">{fmtDT(s.opened_at)}</p>
                  {s.terminal_id && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${termColor(s.terminal_id)}`}>
                      {s.terminal_id.toUpperCase()}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">ปิด {fmtDT(s.closed_at)}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-brand text-sm">฿{fmt(s.sales_total)}</p>
                <p className="text-[10px] text-slate-400">{s.sales_count} บิล</p>
              </div>
            </div>

            {/* Diff badge */}
            {s.difference !== null && (
              <div className={`mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                Math.abs(s.difference) < 1 ? 'bg-emerald-100 text-emerald-700' :
                s.difference > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'
              }`}>
                {Math.abs(s.difference) < 1 ? '✅ ยอดตรง' :
                  s.difference > 0 ? `+฿${fmt(s.difference)} เงินเกิน` : `−฿${fmt(Math.abs(s.difference))} เงินขาด`}
              </div>
            )}

            {/* Detail expand */}
            {detail?.id === s.id && (
              <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <Row label="เงินเริ่มต้น" val={`฿${fmt(s.opening_cash)}`} />
                <Row label="เงินปิดกะ" val={`฿${fmt(s.closing_cash)}`} />
                <Row label="ยอดขายเงินสด" val={s.cash_sales != null ? `฿${fmt(s.cash_sales)}` : '—'} />
                <Row label="ควรมีในเก๊ะ" val={`฿${fmt(s.expected_cash)}`} />
                {s.note && <div className="col-span-2 text-xs text-slate-400 italic">หมายเหตุ: {s.note}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Row({ label, val }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className="font-semibold text-slate-700 text-xs">{val}</span>
    </div>
  )
}
