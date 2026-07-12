'use client'
import { useState, useEffect, useCallback } from 'react'

const KEYS = ['1','2','3','4','5','6','7','8','9','⌫','0','✓']
const PALETTE = ['bg-brand','bg-blue-500','bg-emerald-500','bg-amber-500','bg-purple-500','bg-pink-500']

function Numpad({ onKey, confirmDisabled, loading }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {KEYS.map(k => (
        <button key={k} onClick={() => onKey(k)} disabled={loading}
          className={`h-16 rounded-2xl text-2xl font-bold transition-all active:scale-95 select-none shadow-sm
            ${k==='✓' ? confirmDisabled ? 'bg-slate-200 text-slate-400' : 'bg-brand text-white shadow-brand/30 shadow-md'
              : k==='⌫' ? 'bg-slate-200 text-slate-600' : 'bg-white text-slate-800 border border-slate-100'}
            ${loading ? 'opacity-40' : ''}`}>
          {loading && k==='✓' ? '…' : k}
        </button>
      ))}
    </div>
  )
}

const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
const fmtDate  = d => d ? new Date(d+'T00:00:00').toLocaleDateString('th-TH', { day:'numeric', month:'long', year:'numeric' }) : ''

export default function LeavePage() {
  const [employees, setEmployees] = useState([])
  const [step, setStep]           = useState('select') // select | pin | form | done
  const [selected, setSelected]   = useState(null)
  const [pin, setPin]             = useState('')
  const [empPin, setEmpPin]       = useState('')
  const [dateFrom, setDateFrom]   = useState(todayStr())
  const [dateTo, setDateTo]       = useState(todayStr())
  const [note, setNote]           = useState('')
  const [loading, setLoading]     = useState(false)
  const [result, setResult]       = useState(null)

  useEffect(() => {
    fetch('/api/checkin').then(r => r.json()).then(setEmployees).catch(() => {})
  }, [])

  const reset = useCallback(() => {
    setStep('select'); setSelected(null); setPin(''); setEmpPin('')
    setDateFrom(todayStr()); setDateTo(todayStr()); setNote(''); setResult(null)
  }, [])

  useEffect(() => {
    if (!result) return
    const id = setTimeout(reset, 4000)
    return () => clearTimeout(id)
  }, [result, reset])

  async function verifyPin(p) {
    setLoading(true)
    try {
      const res = await fetch('/api/checkin', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ employee_id: selected.id, pin: p, verifyOnly: true }),
      })
      const data = await res.json()
      if (data.error) { setResult(data); setStep('done'); return }
      setEmpPin(p); setStep('form')
    } catch { setResult({ error: 'เชื่อมต่อไม่ได้' }); setStep('done') }
    finally { setLoading(false); setPin('') }
  }

  async function submitLeave() {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/leave', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ employee_id: selected.id, pin: empPin, leave_type: 'holiday', date_from: dateFrom, date_to: dateTo, note }),
      })
      setResult(await res.json()); setStep('done')
    } catch { setResult({ error: 'เชื่อมต่อไม่ได้' }); setStep('done') }
    finally { setLoading(false) }
  }

  function pressPin(k) {
    if (loading || result) return
    if (k==='⌫') { setPin(p=>p.slice(0,-1)); return }
    if (k==='✓') { verifyPin(pin); return }
    if (pin.length>=4) return
    const next = pin+k; setPin(next)
    if (next.length===4) verifyPin(next)
  }

  const colorIdx = employees.findIndex(e => e.id === selected?.id)
  const isOk = result && !result.error

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-xs">
        <div className="text-center mb-6">
          <p className="text-4xl mb-1">🏖</p>
          <p className="text-xl font-bold text-slate-700 font-heading">แจ้งลา</p>
        </div>

        {step==='done' && result ? (
          <div className={`rounded-3xl p-8 text-center shadow-lg ${isOk ? 'bg-green-50 border-2 border-green-400' : 'bg-red-50 border-2 border-red-300'}`}>
            {isOk ? <>
              <p className="text-4xl mb-3">✅</p>
              <p className="text-2xl font-bold text-green-700">{result.name}</p>
              <p className="text-sm text-green-600 mt-2">
                {fmtDate(result.date_from)}{result.date_to !== result.date_from && ` – ${fmtDate(result.date_to)}`}
              </p>
              <p className="text-xs text-green-500 mt-2">ส่งคำขอแล้ว · รอ admin อนุมัติ</p>
            </> : <>
              <p className="text-4xl mb-3">❌</p>
              <p className="text-xl font-bold text-red-600">{result.error}</p>
            </>}
          </div>

        ) : step==='select' ? (
          <>
            <p className="text-center text-sm text-slate-500 mb-4">เลือกชื่อของคุณ</p>
            <div className="flex flex-col gap-3">
              {employees.length===0 && <p className="text-center text-slate-300 py-8">กำลังโหลด…</p>}
              {employees.map((emp, i) => (
                <button key={emp.id} onClick={() => { setSelected(emp); setStep('pin') }}
                  className="flex items-center gap-4 bg-white rounded-2xl px-5 py-4 shadow-sm border border-slate-100 active:scale-95 transition-transform text-left w-full">
                  <div className={`w-12 h-12 rounded-full ${PALETTE[i % PALETTE.length]} flex items-center justify-center text-white font-bold text-xl shrink-0`}>
                    {(emp.nickname || emp.name).charAt(0)}
                  </div>
                  <div>
                    <p className="font-bold text-slate-800 text-lg">{emp.nickname || emp.name}</p>
                    {emp.nickname && <p className="text-xs text-slate-400">{emp.name}</p>}
                  </div>
                  <span className="ml-auto text-slate-300 text-xl">›</span>
                </button>
              ))}
            </div>
          </>

        ) : step==='pin' ? (
          <>
            <div className="text-center mb-5">
              <div className={`w-14 h-14 rounded-full ${PALETTE[colorIdx % PALETTE.length]} flex items-center justify-center text-white font-bold text-2xl mx-auto mb-2`}>
                {(selected?.nickname || selected?.name || '').charAt(0)}
              </div>
              <p className="font-bold text-slate-700">{selected?.nickname || selected?.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">กรอก PIN 4 หลัก</p>
            </div>
            <div className="flex justify-center gap-4 mb-6">
              {Array.from({length:4}).map((_,i) => (
                <div key={i} className={`w-5 h-5 rounded-full border-2 transition-all ${i<pin.length ? 'bg-brand border-brand scale-110' : 'border-slate-300 bg-white'}`} />
              ))}
            </div>
            <Numpad onKey={pressPin} confirmDisabled={pin.length<4} loading={loading} />
            <div className="mt-4 text-center">
              <button onClick={() => { setStep('select'); setPin('') }} className="text-xs text-slate-400 underline">← เปลี่ยนชื่อ</button>
            </div>
          </>

        ) : (
          <div className="space-y-4">
            <p className="text-center text-slate-500 text-sm">สวัสดี <span className="font-bold text-slate-700">{selected?.nickname || selected?.name}</span></p>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <div>
                <p className="text-xs text-slate-400 mb-1">วันที่เริ่ม</p>
                <input type="date" value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); if (e.target.value > dateTo) setDateTo(e.target.value) }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">วันที่สิ้นสุด</p>
                <input type="date" value={dateTo} min={dateFrom}
                  onChange={e => setDateTo(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
              </div>
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="หมายเหตุ เช่น ธุระ, ป่วย, นัดหมอ…" rows={3}
              className="w-full border border-slate-200 rounded-2xl px-4 py-3 text-sm resize-none focus:border-brand outline-none bg-white" />
            <button onClick={submitLeave} disabled={loading}
              className="w-full bg-brand text-white font-bold text-lg py-4 rounded-2xl shadow-md active:scale-95 transition-all disabled:opacity-40">
              {loading ? 'กำลังส่ง…' : '📨 ส่งคำขอลา'}
            </button>
          </div>
        )}

        <div className="mt-6 text-center">
          <a href="/staff" className="text-xs text-slate-300 underline">← กลับ</a>
        </div>
      </div>
    </div>
  )
}
