'use client'
import { useEffect, useState } from 'react'

export default function ApprovePage() {
  const [phase, setPhase]     = useState('loading') // loading|ready|acting|done|error|already
  const [detail, setDetail]   = useState(null)  // { title, rows, status }
  const [request, setRequest] = useState(null)  // { type, id }
  const [profile, setProfile] = useState(null)  // LINE profile
  const [result, setResult]   = useState('')

  useEffect(() => {
    const p    = new URLSearchParams(window.location.search)
    const type = p.get('type')
    const id   = p.get('id')
    if (!type || !id) { setPhase('error'); return }
    setRequest({ type, id })

    import('@line/liff').then(async ({ default: liff }) => {
      await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID })
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href }); return }

      const [prof, res] = await Promise.all([
        liff.getProfile(),
        fetch(`/api/approve-detail?type=${type}&id=${id}`),
      ])
      setProfile(prof)
      const data = await res.json()
      if (!res.ok) { setPhase('error'); return }
      if (data.status !== 'pending') { setPhase('already'); setDetail(data); return }
      setDetail(data)
      setPhase('ready')
    }).catch(e => { console.error('[LIFF]', e); setPhase('error') })
  }, [])

  async function handleAction(action) {
    setPhase('acting')
    try {
      const res = await fetch('/api/push/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          type: request.type,
          id: request.id,
          approved_by: profile?.displayName || 'LINE',
        }),
      })
      if (!res.ok) throw new Error()
      setResult(action === 'approve' ? 'อนุมัติแล้ว ✅' : 'ปฏิเสธแล้ว ❌')
      setPhase('done')
      setTimeout(async () => {
        const { default: liff } = await import('@line/liff')
        liff.closeWindow()
      }, 1800)
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
        <p className="text-sm text-slate-400 mt-2">กำลังปิด...</p>
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
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-2">
        {profile?.pictureUrl && (
          <img src={profile.pictureUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
        )}
        <div>
          <p className="text-xs text-slate-400">ผู้อนุมัติ</p>
          <p className="text-sm font-semibold text-slate-700">{profile?.displayName || '—'}</p>
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 p-4 flex flex-col gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          {/* Card header */}
          <div className={`px-5 py-4 ${
            request?.type === 'drawer'  ? 'bg-violet-600' :
            request?.type === 'leave'   ? 'bg-amber-500'  : 'bg-orange-500'
          }`}>
            <p className="text-white font-bold text-lg">{detail?.title}</p>
          </div>

          {/* Rows */}
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

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => handleAction('reject')}
            className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-600 font-bold text-base active:bg-slate-200"
          >
            ✗  ปฏิเสธ
          </button>
          <button
            onClick={() => handleAction('approve')}
            className="flex-1 py-4 rounded-2xl bg-green-500 text-white font-bold text-base active:bg-green-600"
          >
            ✅  อนุมัติ
          </button>
        </div>
      </div>
    </div>
  )
}
