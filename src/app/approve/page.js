'use client'
import { useEffect, useState } from 'react'

export default function ApprovePage() {
  const [phase, setPhase]   = useState('loading') // loading|ready|acting|done|error|already
  const [detail, setDetail] = useState(null)
  const [request, setRequest] = useState(null)
  const [result, setResult] = useState('')

  useEffect(() => {
    const p    = new URLSearchParams(window.location.search)
    const type = p.get('type')
    const id   = p.get('id')
    if (!type || !id) { setPhase('error'); return }
    setRequest({ type, id })

    fetch(`/api/approve-detail?type=${type}&id=${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setPhase('error'); return }
        if (data.status !== 'pending') { setPhase('already'); setDetail(data); return }
        setDetail(data)
        setPhase('ready')
      })
      .catch(() => setPhase('error'))
  }, [])

  async function handleAction(action) {
    setPhase('acting')
    try {
      const res = await fetch('/api/push/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, type: request.type, id: request.id, approved_by: 'line' }),
      })
      if (!res.ok) throw new Error()
      setResult(action === 'approve' ? 'อนุมัติแล้ว ✅' : 'ปฏิเสธแล้ว ❌')
      setPhase('done')
    } catch {
      setPhase('error')
    }
  }

  if (phase === 'loading' || phase === 'acting') return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <div className="text-slate-400 text-sm animate-pulse">กำลังโหลด...</div>
    </div>
  )

  if (phase === 'error') return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 p-6">
      <div className="text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <p className="text-slate-600">เกิดข้อผิดพลาด กรุณาลองใหม่</p>
      </div>
    </div>
  )

  if (phase === 'done') return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <div className="text-center">
        <p className="text-3xl font-bold text-slate-800">{result}</p>
      </div>
    </div>
  )

  if (phase === 'already') return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 p-6">
      <div className="text-center">
        <div className="text-4xl mb-3">ℹ️</div>
        <p className="font-semibold text-slate-700">{detail?.title}</p>
        <p className="text-sm text-slate-400 mt-1">
          {detail?.status === 'approved' ? 'อนุมัติแล้ว ✅' : 'ปฏิเสธแล้ว ❌'}
        </p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Card */}
      <div className="flex-1 p-4 flex flex-col gap-4 justify-center max-w-sm mx-auto w-full">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className={`px-5 py-4 ${
            request?.type === 'drawer' ? 'bg-violet-600' :
            request?.type === 'leave'  ? 'bg-amber-500'  : 'bg-orange-500'
          }`}>
            <p className="text-white font-bold text-lg">{detail?.title}</p>
          </div>
          <div className="divide-y divide-slate-50">
            {detail?.rows?.map((row, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-slate-500">{row.label}</span>
                <span className={`text-sm font-semibold ${row.highlight ? 'text-orange-500' : 'text-slate-800'}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => handleAction('reject')}
            className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-600 font-bold text-base active:bg-slate-200">
            ✗ ปฏิเสธ
          </button>
          <button onClick={() => handleAction('approve')}
            className="flex-1 py-4 rounded-2xl bg-green-500 text-white font-bold text-base active:bg-green-600">
            ✅ อนุมัติ
          </button>
        </div>
      </div>
    </div>
  )
}
