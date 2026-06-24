'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LiffSummary() {
  const router = useRouter()
  const [member,  setMember]  = useState(null)
  const [income,  setIncome]  = useState([])
  const [bills,   setBills]   = useState([])
  const [loading, setLoading] = useState(true)
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthTH = now.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })

  useEffect(() => {
    async function init() {
      const liff = (await import('@line/liff')).default
      await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID })
      if (!liff.isLoggedIn()) { liff.login(); return }
      const p = await liff.getProfile()
      const res = await fetch('/api/family/setup')
      const { members } = await res.json()
      const m = members.find(x => x.line_user_id === p.userId)
      setMember(m)
      if (m?.business_id) {
        const [iRes, bRes] = await Promise.all([
          fetch(`/api/family/income?business_id=${m.business_id}&month=${month}`),
          fetch(`/api/family/bills?business_id=${m.business_id}`),
        ])
        setIncome(await iRes.json())
        setBills(await bRes.json())
      }
      setLoading(false)
    }
    init()
  }, [])

  const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const totalIncome = income.reduce((s, r) => s + Number(r.amount), 0)
  const paidBills   = bills.filter(b => b.status === 'paid' && b.paid_at?.startsWith(month))
  const pendingBills = bills.filter(b => b.status === 'pending')
  const totalPaid   = paidBills.reduce((s, b) => s + Number(b.amount), 0)
  const totalPending = pendingBills.reduce((s, b) => s + Number(b.amount), 0)

  if (loading) return <div className="flex justify-center items-center min-h-screen"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>

  const bizColor = member?.family_businesses?.color || '#1a56c4'

  return (
    <div className="max-w-sm mx-auto pb-8">
      <div className="p-4 text-white" style={{ backgroundColor: bizColor }}>
        <button onClick={() => router.back()} className="text-white/80 text-sm mb-2">← กลับ</button>
        <h1 className="text-xl font-bold">📊 สรุปเดือนนี้</h1>
        <p className="text-sm opacity-80">{monthTH} · {member?.family_businesses?.name}</p>
      </div>

      <div className="p-4 space-y-3">
        {/* การ์ดหลัก */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
            <p className="text-xs text-green-700 font-medium">💰 รายรับ</p>
            <p className="text-xl font-bold text-green-700 mt-1">฿{fmt(totalIncome)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{income.length} รายการ</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-xs text-red-700 font-medium">💳 จ่ายแล้ว</p>
            <p className="text-xl font-bold text-red-700 mt-1">฿{fmt(totalPaid)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{paidBills.length} บิล</p>
          </div>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs text-orange-700 font-medium">⏳ ยังไม่ได้จ่าย</p>
              <p className="text-xl font-bold text-orange-700 mt-1">฿{fmt(totalPending)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">{pendingBills.length} บิล</p>
              <p className="text-lg font-bold text-blue-600 mt-1">
                ฿{fmt(totalIncome - totalPaid)}
              </p>
              <p className="text-xs text-gray-400">คงเหลือสุทธิ</p>
            </div>
          </div>
        </div>

        {/* รายรับรายวัน */}
        {income.length > 0 && (
          <div>
            <h2 className="font-semibold text-gray-700 mb-2 text-sm">รายรับรายวัน</h2>
            <div className="space-y-2">
              {income.slice(0, 10).map(r => (
                <div key={r.id} className="flex justify-between items-center bg-white border rounded-xl px-3 py-2">
                  <div>
                    <p className="text-sm text-gray-700">{new Date(r.date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })}</p>
                    {r.note && <p className="text-xs text-gray-400">{r.note}</p>}
                  </div>
                  <p className="font-semibold text-green-600">฿{fmt(r.amount)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* บิลที่ยังค้าง */}
        {pendingBills.length > 0 && (
          <div>
            <h2 className="font-semibold text-gray-700 mb-2 text-sm">บิลค้างจ่าย</h2>
            <div className="space-y-2">
              {pendingBills.map(b => (
                <div key={b.id} className="flex justify-between items-center bg-white border rounded-xl px-3 py-2">
                  <div>
                    <p className="text-sm text-gray-700">{b.vendor || 'ไม่ระบุ'}</p>
                    <p className="text-xs text-gray-400">{b.due_date ? `ครบ ${new Date(b.due_date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })}` : ''}</p>
                  </div>
                  <p className="font-semibold text-red-600">฿{fmt(b.amount)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
