'use client'
import { familyFetch } from '@/lib/familyFetch'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const STATUS_LABEL = { pending: '⏳ รอจ่าย', paid: '✅ จ่ายแล้ว', cancelled: '❌ ยกเลิก' }
const STATUS_BG    = { pending: 'bg-orange-50 border-orange-200', paid: 'bg-green-50 border-green-200', cancelled: 'bg-gray-50 border-gray-200' }

export default function LiffBills() {
  const router = useRouter()
  const [bills,   setBills]   = useState([])
  const [member,  setMember]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState('pending')

  useEffect(() => {
    async function init() {
      const liff = (await import('@line/liff')).default
      await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID })
      if (!liff.isLoggedIn()) { liff.login(); return }
      const p = await liff.getProfile()

      const res = await familyFetch('/api/family/setup')
      const { members } = await res.json()
      const m = members.find(x => x.line_user_id === p.userId)
      setMember(m)
      if (m?.business_id) await loadBills(m.business_id)
      setLoading(false)
    }
    init()
  }, [])

  async function loadBills(bizId) {
    const res = await familyFetch(`/api/family/bills?business_id=${bizId}`)
    setBills(await res.json())
  }

  async function markPaid(billId) {
    await familyFetch('/api/family/bills', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: billId, status: 'paid' }),
    })
    if (member?.business_id) await loadBills(member.business_id)
  }

  const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  const fmtDate = d => d ? new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) : '-'
  const today = new Date(); today.setHours(0,0,0,0)
  const daysLeft = d => { if (!d) return null; const x = new Date(d); x.setHours(0,0,0,0); return Math.round((x - today) / 86400000) }

  const filtered = bills.filter(b => b.status === tab)

  if (loading) return <div className="flex justify-center items-center min-h-screen"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="max-w-sm mx-auto pb-8">
      <div className="sticky top-0 bg-white shadow-sm px-4 pt-4 pb-3 z-10">
        <button onClick={() => router.back()} className="text-blue-600 text-sm mb-2">← กลับ</button>
        <h1 className="text-lg font-bold text-gray-800">📋 รายการบิล</h1>
        {member?.family_businesses && (
          <p className="text-xs text-gray-500">🏢 {member.family_businesses.name}</p>
        )}
        <div className="flex gap-2 mt-3">
          {['pending', 'paid'].map(s => (
            <button key={s} onClick={() => setTab(s)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${tab === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 mt-4 space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <div className="text-4xl mb-2">🎉</div>
            <p className="text-sm">{tab === 'pending' ? 'ไม่มีบิลค้างจ่าย' : 'ยังไม่มีรายการ'}</p>
          </div>
        )}
        {filtered.map(b => {
          const dl = daysLeft(b.due_date)
          const urgency = dl === null ? '' : dl < 0 ? '🔴 เกินกำหนด' : dl === 0 ? '🔴 วันนี้' : dl <= 3 ? `🟠 อีก ${dl} วัน` : dl <= 7 ? `🟡 อีก ${dl} วัน` : `อีก ${dl} วัน`
          return (
            <div key={b.id} className={`border rounded-2xl p-4 ${STATUS_BG[b.status] || ''}`}>
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-gray-800">{b.vendor || 'ไม่ระบุ'}</p>
                  <p className="text-xs text-gray-500">{b.category}</p>
                </div>
                <p className="text-lg font-bold text-red-600">฿{fmt(b.amount)}</p>
              </div>
              <div className="mt-2 flex justify-between items-center">
                <div>
                  <p className="text-xs text-gray-500">ครบกำหนด: {fmtDate(b.due_date)}</p>
                  {urgency && <p className="text-xs font-medium mt-0.5">{urgency}</p>}
                </div>
                {b.status === 'pending' && (
                  <button onClick={() => markPaid(b.id)}
                    className="px-4 py-1.5 bg-green-600 text-white rounded-xl text-sm font-medium">
                    จ่ายแล้ว
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
