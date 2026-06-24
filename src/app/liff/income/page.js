'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LiffIncome() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [member,  setMember]  = useState(null)
  const [amount,  setAmount]  = useState('')
  const [date,    setDate]    = useState(new Date().toISOString().slice(0, 10))
  const [note,    setNote]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const [done,    setDone]    = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    async function init() {
      const liff = (await import('@line/liff')).default
      await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID })
      if (!liff.isLoggedIn()) { liff.login(); return }
      const p = await liff.getProfile()
      setProfile(p)

      const res = await fetch('/api/family/setup')
      const { members } = await res.json()
      const m = members.find(x => x.line_user_id === p.userId)
      setMember(m || null)
    }
    init()
  }, [])

  async function save() {
    if (!amount || !member) return
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/family/income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: member.business_id,
          date, amount: Number(amount), note,
          line_user_id: profile?.userId,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (done) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center">
        <div className="text-6xl mb-4">✅</div>
        <p className="text-xl font-bold text-gray-800 mb-1">บันทึกแล้ว</p>
        <p className="text-green-600 font-semibold text-2xl mb-6">
          ฿{Number(amount).toLocaleString('th-TH')}
        </p>
        <button onClick={() => { setDone(false); setAmount(''); setNote('') }}
          className="px-6 py-2 bg-blue-600 text-white rounded-xl mr-2">เพิ่มอีก</button>
        <button onClick={() => router.push('/liff')}
          className="px-6 py-2 bg-gray-200 rounded-xl">กลับ</button>
      </div>
    </div>
  )

  return (
    <div className="max-w-sm mx-auto p-4 pt-6">
      <button onClick={() => router.back()} className="text-blue-600 text-sm mb-4">← กลับ</button>
      <h1 className="text-xl font-bold text-gray-800 mb-1">💰 เพิ่มรายรับ</h1>
      {member?.family_businesses && (
        <p className="text-sm text-gray-500 mb-5">🏢 {member.family_businesses.name}</p>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">วันที่</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full border rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ยอดรายรับ (บาท)</label>
          <input type="number" inputMode="decimal" placeholder="0.00" value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-full border rounded-xl px-4 py-3 text-2xl font-bold text-green-600 focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>

        {/* ปุ่มกดเร็ว */}
        <div className="flex gap-2 flex-wrap">
          {[500, 1000, 2000, 5000, 10000].map(v => (
            <button key={v} onClick={() => setAmount(String(v))}
              className="px-3 py-1.5 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm font-medium">
              +{v.toLocaleString()}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ (ถ้ามี)</label>
          <input type="text" placeholder="เช่น ยอดขายเช้า, ยอดขายเย็น" value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full border rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button onClick={save} disabled={!amount || saving || !member}
          className="w-full bg-green-600 text-white py-4 rounded-2xl font-bold text-lg disabled:opacity-50">
          {saving ? 'กำลังบันทึก...' : 'บันทึกรายรับ'}
        </button>
      </div>
    </div>
  )
}
