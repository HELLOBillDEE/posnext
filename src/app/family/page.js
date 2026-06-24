'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const fmtDate = d => d ? new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' }) : '-'
function daysLeft(d) {
  if (!d) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const x = new Date(d); x.setHours(0,0,0,0)
  return Math.round((x - today) / 86400000)
}

export default function FamilyDashboard() {
  const [businesses, setBusinesses] = useState([])
  const [incomeMap,  setIncomeMap]  = useState({})  // bizId → [rows]
  const [billsMap,   setBillsMap]   = useState({})  // bizId → [rows]
  const [loading,    setLoading]    = useState(true)
  const [lastUpdate, setLastUpdate] = useState(new Date())

  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const loadAll = useCallback(async () => {
    const { data: biz } = await db.from('family_businesses').select('*').order('created_at')
    if (!biz?.length) { setLoading(false); return }
    setBusinesses(biz)

    const results = await Promise.all(biz.map(async b => {
      const [{ data: income }, { data: bills }] = await Promise.all([
        db.from('family_income').select('*').eq('business_id', b.id)
          .gte('date', `${thisMonth}-01`).lte('date', `${thisMonth}-31`).order('date', { ascending: false }),
        db.from('family_bills').select('*').eq('business_id', b.id).order('due_date', { ascending: true }),
      ])
      return { id: b.id, income: income || [], bills: bills || [] }
    }))

    const iMap = {}, bMap = {}
    results.forEach(r => { iMap[r.id] = r.income; bMap[r.id] = r.bills })
    setIncomeMap(iMap)
    setBillsMap(bMap)
    setLastUpdate(new Date())
    setLoading(false)
  }, [thisMonth])

  useEffect(() => {
    loadAll()

    // Real-time subscription
    const channel = db.channel('family-finance')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'family_income' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'family_bills' }, loadAll)
      .subscribe()

    return () => db.removeChannel(channel)
  }, [loadAll])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500 text-sm">กำลังโหลด...</p>
      </div>
    </div>
  )

  // รายการบิลใกล้ครบกำหนด (ทุกธุรกิจ)
  const allPending = businesses.flatMap(b =>
    (billsMap[b.id] || [])
      .filter(bill => bill.status === 'pending' && bill.due_date)
      .map(bill => ({ ...bill, bizName: b.name, bizColor: b.color }))
  ).sort((a, b) => new Date(a.due_date) - new Date(b.due_date))

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1e3a5f] text-white px-4 py-5 sticky top-0 z-10 shadow">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold">💼 Family Finance</h1>
            <p className="text-xs text-blue-200 mt-0.5">
              {now.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })} · แต่ละธุรกิจแยกกัน
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-300">Live</span>
            </div>
            <p className="text-xs text-blue-300 mt-0.5">
              {lastUpdate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">

        {/* การ์ดแต่ละธุรกิจ — แยกกัน ไม่รวม */}
        {businesses.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">🏢</p>
            <p>ยังไม่มีธุรกิจในระบบ</p>
            <p className="text-sm mt-1">เพิ่มธุรกิจผ่าน Admin Setup ก่อน</p>
          </div>
        ) : (
          businesses.map(biz => {
            const income  = incomeMap[biz.id] || []
            const bills   = billsMap[biz.id]  || []
            const todayISO = now.toISOString().slice(0, 10)
            const todayIncome = income.filter(r => r.date === todayISO).reduce((s, r) => s + Number(r.amount), 0)
            const monthIncome = income.reduce((s, r) => s + Number(r.amount), 0)
            const pending = bills.filter(b => b.status === 'pending')
            const paidThisMonth = bills.filter(b => b.status === 'paid' && b.paid_at?.startsWith(thisMonth))
            const totalPending = pending.reduce((s, b) => s + Number(b.amount), 0)
            const totalPaid    = paidThisMonth.reduce((s, b) => s + Number(b.amount), 0)

            return (
              <div key={biz.id} className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
                {/* Header ธุรกิจ */}
                <div className="px-4 py-3 text-white" style={{ backgroundColor: biz.color || '#1a56c4' }}>
                  <h2 className="font-bold text-base">{biz.name}</h2>
                </div>

                {/* ตัวเลขสรุป */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-y divide-gray-100">
                  <Stat label="รายรับวันนี้" value={`฿${fmt(todayIncome)}`} color="text-green-600" />
                  <Stat label="รายรับเดือนนี้" value={`฿${fmt(monthIncome)}`} color="text-green-700" />
                  <Stat label="จ่ายแล้ว (เดือนนี้)" value={`฿${fmt(totalPaid)}`} color="text-gray-600" />
                  <Stat label="ยังไม่ได้จ่าย" value={`฿${fmt(totalPending)}`} color="text-red-600"
                    sub={pending.length > 0 ? `${pending.length} บิล` : undefined} />
                </div>

                {/* บิลค้างจ่าย */}
                {pending.length > 0 && (
                  <div className="px-4 pb-4 mt-2">
                    <p className="text-xs font-semibold text-gray-500 mb-2">📋 บิลค้างจ่าย</p>
                    <div className="space-y-1.5">
                      {pending.slice(0, 5).map(b => {
                        const dl = daysLeft(b.due_date)
                        const urgencyColor = dl === null ? 'text-gray-500' : dl < 0 ? 'text-red-600 font-bold' : dl <= 3 ? 'text-orange-500 font-semibold' : dl <= 7 ? 'text-yellow-600' : 'text-gray-400'
                        const urgencyText = dl === null ? '' : dl < 0 ? `เกิน ${Math.abs(dl)} วัน` : dl === 0 ? 'วันนี้!' : `อีก ${dl} วัน`
                        return (
                          <div key={b.id} className="flex justify-between items-center bg-gray-50 rounded-xl px-3 py-2">
                            <div>
                              <p className="text-sm text-gray-700">{b.vendor || 'ไม่ระบุ'}</p>
                              <p className="text-xs text-gray-400">{fmtDate(b.due_date)} <span className={urgencyColor}>· {urgencyText}</span></p>
                            </div>
                            <p className="text-sm font-bold text-red-600">฿{fmt(b.amount)}</p>
                          </div>
                        )
                      })}
                      {pending.length > 5 && <p className="text-xs text-gray-400 text-center">+{pending.length - 5} รายการอื่น</p>}
                    </div>
                  </div>
                )}

                {/* รายรับล่าสุด */}
                {income.slice(0, 3).length > 0 && (
                  <div className="px-4 pb-4">
                    <p className="text-xs font-semibold text-gray-500 mb-2">💰 รายรับล่าสุด</p>
                    <div className="space-y-1.5">
                      {income.slice(0, 3).map(r => (
                        <div key={r.id} className="flex justify-between items-center">
                          <p className="text-xs text-gray-500">{fmtDate(r.date)}{r.note ? ` · ${r.note}` : ''}</p>
                          <p className="text-sm font-semibold text-green-600">฿{fmt(r.amount)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}

        {/* แจ้งเตือนรวมทุกธุรกิจ */}
        {allPending.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <h2 className="font-bold text-amber-800 mb-3 text-sm">🔔 บิลครบกำหนดใน 7 วัน (ทุกธุรกิจ)</h2>
            <div className="space-y-2">
              {allPending
                .filter(b => { const dl = daysLeft(b.due_date); return dl !== null && dl <= 7 })
                .map(b => {
                  const dl = daysLeft(b.due_date)
                  const tag = dl < 0 ? '🔴' : dl === 0 ? '🔴' : dl <= 3 ? '🟠' : '🟡'
                  return (
                    <div key={b.id} className="flex justify-between items-center">
                      <div>
                        <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full text-white mr-2"
                          style={{ backgroundColor: b.bizColor }}>{b.bizName}</span>
                        <span className="text-sm text-gray-700">{b.vendor || 'ไม่ระบุ'}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-red-700">฿{fmt(b.amount)}</p>
                        <p className="text-xs text-gray-500">{tag} {fmtDate(b.due_date)}</p>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-300 pb-4">
          ⚠️ แต่ละธุรกิจเป็นเงินแยกกัน — ไม่มีการรวมยอดข้ามธุรกิจ
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value, color, sub }) {
  return (
    <div className="px-4 py-3 text-center">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-base font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
