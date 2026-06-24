'use client'
import { familyFetch } from '@/lib/familyFetch'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense } from 'react'

function ConfirmPage() {
  const params = useSearchParams()
  const router = useRouter()
  const scanId = params.get('id')

  const [scan,    setScan]    = useState(null)
  const [profile, setProfile] = useState(null)
  const [form,    setForm]    = useState({})
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

      if (!scanId) { setError('ไม่พบ scan ID'); return }
      const res = await familyFetch(`/api/family/confirm?id=${scanId}`)
      if (!res.ok) { setError('ไม่พบรายการ หรือหมดอายุแล้ว'); return }
      const data = await res.json()
      setScan(data)
      setForm({
        vendor: data.ai_data?.vendor || '',
        amount: data.ai_data?.amount || '',
        due_date: data.ai_data?.due_date || '',
        category: data.ai_data?.category || 'อื่นๆ',
        note: '',
      })
    }
    init()
  }, [scanId])

  async function confirm() {
    setSaving(true); setError('')
    try {
      const res = await familyFetch('/api/family/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, lineUserId: profile?.userId, overrides: form }),
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
        <p className="text-xl font-bold text-gray-800 mb-1">บันทึกบิลแล้ว</p>
        <p className="text-gray-500 text-sm mb-6">ระบบแจ้งเตือนอัตโนมัติเมื่อใกล้ครบกำหนด</p>
        <button onClick={() => router.push('/liff')} className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium">
          กลับหน้าหลัก
        </button>
      </div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center">
        <div className="text-5xl mb-3">⚠️</div>
        <p className="text-gray-700 font-medium mb-4">{error}</p>
        <button onClick={() => router.push('/liff')} className="px-6 py-2 bg-gray-200 rounded-xl">กลับ</button>
      </div>
    </div>
  )

  if (!scan) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const cats = ['ค่าเช่า', 'ค่าน้ำไฟ', 'ค่าวัสดุ', 'เงินเดือน', 'ค่าขนส่ง', 'ค่าโฆษณา', 'อื่นๆ']
  const bizColor = scan.family_businesses?.color || '#1a56c4'

  return (
    <div className="max-w-sm mx-auto p-4 pt-6">
      <div className="rounded-2xl overflow-hidden shadow mb-5">
        <div className="p-4 text-white" style={{ backgroundColor: bizColor }}>
          <p className="font-bold text-lg">📋 ตรวจสอบบิล</p>
          <p className="text-sm opacity-80">{scan.family_businesses?.name}</p>
        </div>
        <div className="bg-white p-4 space-y-4">

          <div>
            <label className="block text-xs text-gray-500 mb-1">ผู้ออกบิล / เจ้าหนี้</label>
            <input value={form.vendor || ''} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
              className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">ยอดที่ต้องจ่าย (฿)</label>
            <input type="number" inputMode="decimal" value={form.amount || ''} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              className="w-full border rounded-xl px-3 py-2.5 text-xl font-bold text-red-600 focus:outline-none focus:ring-2 focus:ring-red-400" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">วันครบกำหนดชำระ</label>
            <input type="date" value={form.due_date || ''} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
              className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">หมวดหมู่</label>
            <select value={form.category || 'อื่นๆ'} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              {cats.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">หมายเหตุเพิ่มเติม</label>
            <input value={form.note || ''} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>
      </div>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      <div className="flex gap-3">
        <button onClick={() => router.push('/liff')}
          className="flex-1 py-3 border border-gray-300 rounded-2xl text-gray-600 font-medium">
          ❌ ยกเลิก
        </button>
        <button onClick={confirm} disabled={saving}
          className="flex-1 py-3 bg-green-600 text-white rounded-2xl font-bold disabled:opacity-50">
          {saving ? 'กำลังบันทึก...' : '✅ ยืนยัน'}
        </button>
      </div>
    </div>
  )
}

export default function ConfirmPageWrapper() {
  return <Suspense><ConfirmPage /></Suspense>
}
