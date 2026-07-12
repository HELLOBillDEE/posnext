'use client'
import { useState, useEffect, useCallback } from 'react'

const KEYS = ['1','2','3','4','5','6','7','8','9','⌫','0','✓']
const PALETTE = ['bg-brand','bg-blue-500','bg-emerald-500','bg-amber-500','bg-purple-500','bg-pink-500']
const fmtMoney = n => Number(n).toLocaleString('th-TH')

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

export default function AdvancePage() {
  const [employees, setEmployees] = useState([])
  const [step, setStep]         = useState('select') // select | pin | amount | result
  const [selected, setSelected] = useState(null)
  const [pin, setPin]           = useState('')
  const [empPin, setEmpPin]     = useState('')
  const [amount, setAmount]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState(null)

  useEffect(() => {
    fetch('/api/checkin').then(r => r.json()).then(setEmployees).catch(() => {})
  }, [])

  const reset = useCallback(() => {
    setStep('select'); setSelected(null); setPin(''); setEmpPin(''); setAmount(''); setResult(null)
  }, [])

  useEffect(() => {
    if (!result) return
    const id = setTimeout(reset, 3500)
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
      if (data.error) { setResult(data); setStep('result'); return }
      setEmpPin(p); setStep('amount')
    } catch { setResult({ error: 'เชื่อมต่อไม่ได้' }); setStep('result') }
    finally { setLoading(false); setPin('') }
  }

  async function submitAdvance() {
    if (!amount || loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/advance', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ employee_id: selected.id, pin: empPin, amount: Number(amount) }),
      })
      setResult(await res.json()); setStep('result')
    } catch { setResult({ error: 'เชื่อมต่อไม่ได้' }); setStep('result') }
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

  function pressAmount(k) {
    if (loading || result) return
    if (k==='⌫') { setAmount(a=>a.slice(0,-1)); return }
    if (k==='✓') { submitAdvance(); return }
    if (amount.length>=6) return
    setAmount(a=>a+k)
  }

  const colorIdx = employees.findIndex(e => e.id === selected?.id)
  const isAdv = result && result.amount !== undefined && !result.error

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-xs">
        <div className="text-center mb-6">
          <p className="text-4xl mb-1">💵</p>
          <p className="text-xl font-bold text-slate-700 font-heading">เบิกเงินล่วงหน้า</p>
        </div>

        {step==='result' && result ? (
          <div className={`rounded-3xl p-8 text-center shadow-lg ${isAdv ? 'bg-amber-50 border-2 border-amber-400' : 'bg-red-50 border-2 border-red-300'}`}>
            {isAdv ? <>
              <p className="text-4xl mb-3">✅</p>
              <p className="text-2xl font-bold text-amber-700">{result.name}</p>
              <p className="text-amber-600 mt-1">ส่งคำขอเบิกแล้ว</p>
              <p className="text-3xl font-bold text-amber-700 mt-3">฿{fmtMoney(result.amount)}</p>
              <p className="text-xs text-amber-500 mt-2">รอ admin อนุมัติ</p>
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
          <>
            <div className="text-center mb-5">
              <p className="text-slate-500 text-sm">สวัสดี <span className="font-bold text-slate-700">{selected?.nickname || selected?.name}</span></p>
              <p className="text-slate-400 text-xs mt-0.5">กรอกจำนวนเงินที่ต้องการเบิก</p>
              <div className="mt-3 bg-white rounded-2xl py-4 px-6 border border-slate-100 shadow-sm">
                <p className="text-4xl font-bold text-amber-600 tracking-widest">
                  {amount ? `฿${fmtMoney(Number(amount))}` : <span className="text-slate-300">฿0</span>}
                </p>
              </div>
            </div>
            <Numpad onKey={pressAmount} confirmDisabled={!amount || amount==='0'} loading={loading} />
          </>
        )}

        <div className="mt-6 text-center">
          <a href="/staff" className="text-xs text-slate-300 underline">← กลับ</a>
        </div>
      </div>
    </div>
  )
}
