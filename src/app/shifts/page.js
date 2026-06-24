'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { fmt, fmtDT } from '@/lib/utils'

export default function ShiftsPage() {
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)

  useEffect(() => { loadShifts() }, [])

  async function loadShifts() {
    setLoading(true)
    const { data } = await supabase.from('shifts')
      .select('*').order('opened_at', { ascending: false }).limit(60)
    setShifts(data || [])
    setLoading(false)
  }

  const openShift = shifts.find(s => s.status === 'open')
  const closedShifts = shifts.filter(s => s.status === 'closed')

  return (
    <div className="max-w-3xl mx-auto px-3 py-4">
      <h1 className="font-heading font-bold text-xl text-brand mb-4">🕐 ประวัติกะ</h1>

      {/* Open shift banner */}
      {openShift && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-4 flex justify-between items-center">
          <div>
            <p className="font-bold text-emerald-700 text-sm">🟢 กะปัจจุบัน</p>
            <p className="text-xs text-emerald-600 mt-0.5">เปิดเมื่อ {fmtDT(openShift.opened_at)}</p>
            <p className="text-xs text-emerald-600">เงินเริ่มต้น ฿{fmt(openShift.opening_cash)}</p>
          </div>
          <a href="/pos" className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold">
            ไปหน้าขาย →
          </a>
        </div>
      )}

      {loading && <div className="text-center py-12 text-slate-400 text-sm">กำลังโหลด...</div>}

      {!loading && closedShifts.length === 0 && !openShift && (
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
                <p className="font-semibold text-slate-700 text-sm">{fmtDT(s.opened_at)}</p>
                <p className="text-xs text-slate-400 mt-0.5">ปิด {fmtDT(s.closed_at)}</p>
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
                <Row label="ยอดขายเงินสด" val={`฿${fmt((s.sales_total||0) - ((s.closing_cash||0) - (s.opening_cash||0)))}`} />
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
