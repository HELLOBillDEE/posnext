'use client'
import { useState, useEffect, useCallback } from 'react'

const KEYS = ['1','2','3','4','5','6','7','8','9','⌫','0','✓']
const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : ''

function Clock() {
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')
  useEffect(() => {
    const tick = () => {
      const n = new Date()
      setTime(n.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' }))
      setDate(n.toLocaleDateString('th-TH', { weekday:'long', day:'numeric', month:'long', year:'numeric' }))
    }
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [])
  return (
    <div className="text-center mb-6">
      <p className="text-5xl font-bold tracking-widest text-brand font-heading">{time}</p>
      <p className="text-sm text-slate-400 mt-1">{date}</p>
    </div>
  )
}

export default function CheckinPage() {
  const [pin, setPin]         = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)

  const reset = useCallback(() => { setPin(''); setResult(null) }, [])

  useEffect(() => {
    if (!result) return
    const id = setTimeout(reset, 3500)
    return () => clearTimeout(id)
  }, [result, reset])

  async function submit(p) {
    if (!p || loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: p }),
      })
      setResult(await res.json())
    } catch { setResult({ error: 'เชื่อมต่อไม่ได้' }) }
    finally { setLoading(false); setPin('') }
  }

  function pressKey(k) {
    if (loading || result) return
    if (k === '⌫') { setPin(p => p.slice(0, -1)); return }
    if (k === '✓') { submit(pin); return }
    if (pin.length >= 4) return
    const next = pin + k; setPin(next)
    if (next.length === 4) submit(next)
  }

  const isIn   = result?.action === 'in'
  const isOut  = result?.action === 'out'
  const isDone = result?.action === 'done'

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-xs">
        <Clock />

        {result ? (
          <div className={`rounded-3xl p-8 text-center shadow-lg ${
            isIn   ? 'bg-green-50 border-2 border-green-400' :
            isOut  ? 'bg-blue-50  border-2 border-blue-400'  :
            isDone ? 'bg-slate-50 border-2 border-slate-300' :
                     'bg-red-50   border-2 border-red-300'}`}>
            {isIn && <><p className="text-5xl mb-3">👋</p><p className="text-2xl font-bold text-green-700">{result.name}</p><p className="text-green-600 mt-1 font-semibold">เข้างาน</p><p className="text-3xl font-bold text-green-700 mt-2 tracking-widest">{fmtTime(result.time)}</p></>}
            {isOut && <><p className="text-5xl mb-3">🏠</p><p className="text-2xl font-bold text-blue-700">{result.name}</p><p className="text-blue-600 mt-1 font-semibold">ออกงาน</p><p className="text-3xl font-bold text-blue-700 mt-2 tracking-widest">{fmtTime(result.time)}</p></>}
            {isDone && <><p className="text-5xl mb-3">✅</p><p className="text-xl font-bold text-slate-600">{result.name}</p><p className="text-slate-500 mt-1 text-sm">บันทึกครบแล้ววันนี้</p><p className="text-xs text-slate-400 mt-2">เข้า {fmtTime(result.check_in)} · ออก {fmtTime(result.check_out)}</p></>}
            {result.error && <><p className="text-5xl mb-3">❌</p><p className="text-xl font-bold text-red-600">{result.error}</p></>}
          </div>

        ) : (
          <>
            <p className="text-center text-sm text-slate-500 mb-4">กรอก PIN ของคุณ</p>
            <div className="flex justify-center gap-4 mb-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={`w-5 h-5 rounded-full border-2 transition-all ${
                  i < pin.length ? 'bg-brand border-brand scale-110' : 'border-slate-300 bg-white'}`} />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {KEYS.map(k => (
                <button key={k} onClick={() => pressKey(k)} disabled={loading}
                  className={`h-16 rounded-2xl text-2xl font-bold transition-all active:scale-95 select-none shadow-sm
                    ${k==='✓' ? pin.length<4 ? 'bg-slate-200 text-slate-400' : 'bg-brand text-white shadow-brand/30 shadow-md'
                      : k==='⌫' ? 'bg-slate-200 text-slate-600' : 'bg-white text-slate-800 border border-slate-100'}
                    ${loading ? 'opacity-40' : ''}`}>
                  {loading && k === '✓' ? '…' : k}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-6 text-center">
          <a href="/staff" className="text-xs text-slate-300 underline">← กลับ</a>
        </div>
      </div>
    </div>
  )
}
