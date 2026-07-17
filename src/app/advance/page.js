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
  const [employees, setEmployees]   = useState([])
  const [step, setStep]             = useState('select') // select | pin | amount | result
  const [selected, setSelected]     = useState(null)
  const [pin, setPin]               = useState('')
  const [empPin, setEmpPin]         = useState('')
  const [amount, setAmount]         = useState('')
  const [loading, setLoading]       = useState(false)
  const [result, setResult]         = useState(null)
  const [empInfo, setEmpInfo]       = useState(null) // { daily_rate, install_per_day, net_daily, installments }

  useEffect(() => {
    fetch('/api/checkin').then(r => r.json()).then(setEmployees).catch(() => {})
  }, [])

  const reset = useCallback(() => {
    setStep('select'); setSelected(null); setPin(''); setEmpPin('')
    setAmount(''); setResult(null); setEmpInfo(null)
  }, [])

  useEffect(() => {
    if (!result) return
    const id = setTimeout(reset, 4000)
    return () => clearTimeout(id)
  }, [result, reset])

  async function verifyPin(p) {
    setLoading(true)
    try {
      const res  = await fetch('/api/checkin', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ employee_id: selected.id, pin: p, verifyOnly: true }),
      })
      const data = await res.json()
      if (data.error) { setResult(data); setStep('result'); return }

      // โหลด daily_rate และผ่อนของพนักงาน
      setEmpPin(p)
      const infoRes = await fetch(`/api/advance?employee_id=${selected.id}`)
      const info    = await infoRes.json()
      setEmpInfo(info?.error ? null : info)
      setStep('amount')
    } catch { setResult({ error: 'เชื่อมต่อไม่ได้' }); setStep('result') }
    finally { setLoading(false); setPin('') }
  }

  async function submitAdvance(amt) {
    const finalAmt = amt ?? Number(amount)
    if (!finalAmt || loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/advance', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ employee_id: selected.id, pin: empPin, amount: finalAmt }),
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

  const colorIdx   = employees.findIndex(e => e.id === selected?.id)
  const palette    = PALETTE[colorIdx % PALETTE.length]
  const isApproved = result && !result.error
  const netDaily   = empInfo?.net_daily ?? 0
  const customAmt  = Number(amount)
  const overLimit  = customAmt > netDaily && netDaily > 0

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-xs">
        <div className="text-center mb-6">
          <p className="text-4xl mb-1">💵</p>
          <p className="text-xl font-bold text-slate-700 font-heading">เบิกค่าแรง</p>
        </div>

        {/* Result */}
        {step==='result' && result ? (
          <div className={`rounded-3xl p-8 text-center shadow-lg ${isApproved ? result.autoApproved ? 'bg-emerald-50 border-2 border-emerald-400' : 'bg-amber-50 border-2 border-amber-400' : 'bg-red-50 border-2 border-red-300'}`}>
            {isApproved ? <>
              <p className="text-4xl mb-3">{result.autoApproved ? '✅' : '📨'}</p>
              <p className="text-2xl font-bold text-slate-700">{result.name}</p>
              <p className="text-3xl font-bold mt-3 text-emerald-700">฿{fmtMoney(result.amount)}</p>
              {result.autoApproved
                ? <p className="text-emerald-600 font-semibold mt-2">อนุมัติทันที ✅</p>
                : <p className="text-amber-600 mt-2">ส่งขออนุมัติแล้ว<br/><span className="text-xs">รอ admin อนุมัติ</span></p>
              }
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
              <div className={`w-14 h-14 rounded-full ${palette} flex items-center justify-center text-white font-bold text-2xl mx-auto mb-2`}>
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
            <div className="text-center mb-4">
              <div className={`w-12 h-12 rounded-full ${palette} flex items-center justify-center text-white font-bold text-xl mx-auto mb-1`}>
                {(selected?.nickname || selected?.name || '').charAt(0)}
              </div>
              <p className="font-semibold text-slate-700 text-sm">{selected?.nickname || selected?.name}</p>
              {empInfo && (
                <p className="text-xs text-slate-400 mt-0.5">
                  ค่าแรง ฿{fmtMoney(empInfo.daily_rate)}/วัน
                  {empInfo.install_per_day > 0 && ` − ผ่อน ฿${fmtMoney(empInfo.install_per_day)}`}
                </p>
              )}
            </div>

            {/* ปุ่มเบิกค่าแรงวันนี้ */}
            {netDaily > 0 && (
              <button onClick={() => submitAdvance(netDaily)} disabled={loading}
                className="w-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white rounded-2xl py-5 mb-4 shadow-lg shadow-emerald-200 transition-all disabled:opacity-50">
                <p className="text-sm font-medium opacity-80">เบิกค่าแรงวันนี้</p>
                <p className="text-3xl font-bold">฿{fmtMoney(netDaily)}</p>
                <p className="text-xs opacity-70 mt-0.5">อนุมัติทันที ✅</p>
              </button>
            )}

            {/* กรอกจำนวนอื่น */}
            <div className="relative">
              {netDaily > 0 && (
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-px bg-slate-200" />
                  <p className="text-xs text-slate-400">หรือกรอกจำนวนอื่น</p>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
              )}
              <div className={`bg-white rounded-2xl py-4 px-6 border shadow-sm mb-4 text-center transition-colors ${overLimit ? 'border-orange-300' : 'border-slate-100'}`}>
                <p className={`text-4xl font-bold tracking-widest ${overLimit ? 'text-orange-500' : 'text-amber-600'}`}>
                  {amount ? `฿${fmtMoney(Number(amount))}` : <span className="text-slate-300">฿0</span>}
                </p>
                {overLimit && (
                  <p className="text-xs text-orange-500 mt-1">เกิน ฿{fmtMoney(netDaily)} → ต้องขออนุมัติ</p>
                )}
              </div>
              <Numpad onKey={pressAmount} confirmDisabled={!amount || amount==='0'} loading={loading} />
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
