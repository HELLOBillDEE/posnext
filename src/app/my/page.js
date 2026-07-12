'use client'
import { useState, useEffect, useCallback } from 'react'

const KEYS = ['1','2','3','4','5','6','7','8','9','⌫','0','✓']
const PALETTE = ['bg-brand','bg-blue-500','bg-emerald-500','bg-amber-500','bg-purple-500','bg-pink-500']

const STATUS_MAP = {
  pending:  { label: 'รออนุมัติ', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'อนุมัติแล้ว', cls: 'bg-green-100 text-green-700' },
  rejected: { label: 'ไม่อนุมัติ', cls: 'bg-red-100 text-red-700' },
}

const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' }) : '—'
const fmtDate = d => d ? new Date(d+'T00:00:00').toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric' }) : ''
const fmtMoney = n => Number(n).toLocaleString('th-TH')

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || { label: status, cls: 'bg-slate-100 text-slate-500' }
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
}

export default function MyPage() {
  const [employees, setEmployees] = useState([])
  const [step, setStep]         = useState('select') // select | pin | dashboard
  const [selected, setSelected] = useState(null)
  const [pin, setPin]           = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [data, setData]         = useState(null)
  const [tab, setTab]           = useState('today')

  useEffect(() => {
    fetch('/api/checkin').then(r => r.json()).then(setEmployees).catch(() => {})
  }, [])

  // auto-login จาก session ที่เก็บไว้
  useEffect(() => {
    try {
      const saved = localStorage.getItem('my_session')
      if (!saved) return
      const { employee_id, pin: savedPin } = JSON.parse(saved)
      if (!employee_id || !savedPin) return
      setStep('loading')
      fetch('/api/my', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id, pin: savedPin }),
      }).then(r => r.json()).then(json => {
        if (json.error) { localStorage.removeItem('my_session'); setStep('select'); return }
        setSelected({ id: employee_id })
        setData(json); setStep('dashboard')
      }).catch(() => setStep('select'))
    } catch { setStep('select') }
  }, [])

  async function login(p) {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/my', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: selected.id, pin: p }),
      })
      const json = await res.json()
      if (json.error) { setError(json.error); setPin(''); return }
      try { localStorage.setItem('my_session', JSON.stringify({ employee_id: selected.id, pin: p })) } catch {}
      setData(json); setStep('dashboard')
    } catch { setError('เชื่อมต่อไม่ได้') }
    finally { setLoading(false) }
  }

  function pressPin(k) {
    if (loading) return
    if (k === '⌫') { setPin(p => p.slice(0, -1)); setError(null); return }
    if (k === '✓') { login(pin); return }
    if (pin.length >= 4) return
    const next = pin + k; setPin(next)
    if (next.length === 4) login(next)
  }

  function logout() {
    try { localStorage.removeItem('my_session') } catch {}
    setStep('select'); setSelected(null); setPin(''); setData(null); setError(null); setTab('today')
  }

  const colorIdx = employees.findIndex(e => e.id === selected?.id)
  const emp = data?.employee

  /* ── Auto-login loading ── */
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">กำลังโหลด…</p>
        </div>
      </div>
    )
  }

  /* ── Dashboard ── */
  if (step === 'dashboard' && data) {
    const today = data.today
    const todayStr = new Date().toLocaleDateString('th-TH', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
    const pendingLeaves   = data.leaves.filter(l => l.status === 'pending').length
    const pendingAdvances = data.advances.filter(a => a.status === 'pending').length

    return (
      <div className="min-h-screen bg-slate-50">
        {/* Header */}
        <div className="bg-brand text-white px-5 pt-10 pb-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold text-lg`}>
                {(emp.nickname || emp.name).charAt(0)}
              </div>
              <div>
                <p className="font-bold text-lg leading-tight">{emp.nickname || emp.name}</p>
                <p className="text-white/70 text-xs">{emp.position || 'พนักงาน'}</p>
              </div>
            </div>
            <button onClick={logout} className="text-white/70 text-xs underline">เปลี่ยนผู้ใช้</button>
          </div>
          <p className="text-white/60 text-xs mt-3">{todayStr}</p>
        </div>

        {/* Today card */}
        <div className="px-4 -mt-3">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-4">
            <p className="text-xs text-slate-400 mb-2 font-semibold">วันนี้</p>
            {today ? (
              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-slate-400">เข้างาน</p>
                  <p className="text-xl font-bold text-green-600">{fmtTime(today.check_in)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">ออกงาน</p>
                  <p className={`text-xl font-bold ${today.check_out ? 'text-blue-600' : 'text-slate-300'}`}>
                    {today.check_out ? fmtTime(today.check_out) : 'ยังไม่ออก'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-slate-400 text-sm">ยังไม่ได้บันทึกเข้างาน</p>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            {[
              { id:'today', label:'การเข้างาน' },
              { id:'leaves', label:`การลา${pendingLeaves ? ` (${pendingLeaves})` : ''}` },
              { id:'advances', label:`เบิก${pendingAdvances ? ` (${pendingAdvances})` : ''}` },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
                  tab === t.id ? 'bg-brand text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab: การเข้างาน */}
          {tab === 'today' && (
            <div className="space-y-2">
              {data.recentAtt.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">ยังไม่มีประวัติ</p>}
              {data.recentAtt.map((a, i) => (
                <div key={i} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">
                      {new Date(a.date+'T00:00:00').toLocaleDateString('th-TH', { weekday:'short', day:'numeric', month:'short' })}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      เข้า {fmtTime(a.check_in)} {a.check_out ? `· ออก ${fmtTime(a.check_out)}` : '· ยังไม่ออก'}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    a.status === 'present' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                  }`}>{a.status === 'present' ? 'มา' : a.status}</span>
                </div>
              ))}
            </div>
          )}

          {/* Tab: การลา */}
          {tab === 'leaves' && (
            <div className="space-y-2">
              {data.leaves.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">ยังไม่มีประวัติการลา</p>}
              {data.leaves.map(l => (
                <div key={l.id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">
                        {fmtDate(l.date_from)}{l.date_to !== l.date_from ? ` – ${fmtDate(l.date_to)}` : ''}
                      </p>
                      {l.note && <p className="text-xs text-slate-400 mt-0.5">{l.note}</p>}
                      <p className="text-xs text-slate-300 mt-1">
                        ส่งเมื่อ {l.requested_at ? new Date(l.requested_at).toLocaleDateString('th-TH', { day:'numeric', month:'short' }) : '—'}
                      </p>
                    </div>
                    <StatusBadge status={l.status} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tab: เบิก */}
          {tab === 'advances' && (
            <div className="space-y-2">
              {data.advances.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">ยังไม่มีประวัติการเบิก</p>}
              {data.advances.map(a => (
                <div key={a.id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-2xl font-bold text-amber-600">฿{fmtMoney(a.amount)}</p>
                      {a.note && <p className="text-xs text-slate-400 mt-0.5">{a.note}</p>}
                      <p className="text-xs text-slate-300 mt-1">
                        ส่งเมื่อ {a.requested_at ? new Date(a.requested_at).toLocaleDateString('th-TH', { day:'numeric', month:'short' }) : '—'}
                      </p>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="h-8" />
        </div>
      </div>
    )
  }

  /* ── Login ── */
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-xs">
        <div className="text-center mb-6">
          <p className="text-4xl mb-1">📋</p>
          <p className="text-xl font-bold text-slate-700 font-heading">ประวัติของฉัน</p>
        </div>

        {step === 'select' ? (
          <>
            <p className="text-center text-sm text-slate-500 mb-4">เลือกชื่อของคุณ</p>
            <div className="flex flex-col gap-3">
              {employees.length === 0 && <p className="text-center text-slate-300 py-8">กำลังโหลด…</p>}
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

        ) : (
          <>
            <div className="text-center mb-5">
              <div className={`w-14 h-14 rounded-full ${PALETTE[colorIdx % PALETTE.length]} flex items-center justify-center text-white font-bold text-2xl mx-auto mb-2`}>
                {(selected?.nickname || selected?.name || '').charAt(0)}
              </div>
              <p className="font-bold text-slate-700">{selected?.nickname || selected?.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">กรอก PIN 4 หลัก</p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-center mb-4">
                <p className="text-red-600 text-sm font-semibold">❌ {error}</p>
              </div>
            )}

            <div className="flex justify-center gap-4 mb-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={`w-5 h-5 rounded-full border-2 transition-all ${i < pin.length ? 'bg-brand border-brand scale-110' : 'border-slate-300 bg-white'}`} />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {KEYS.map(k => (
                <button key={k} onClick={() => pressPin(k)} disabled={loading}
                  className={`h-16 rounded-2xl text-2xl font-bold transition-all active:scale-95 select-none shadow-sm
                    ${k==='✓' ? pin.length<4 ? 'bg-slate-200 text-slate-400' : 'bg-brand text-white shadow-brand/30 shadow-md'
                      : k==='⌫' ? 'bg-slate-200 text-slate-600' : 'bg-white text-slate-800 border border-slate-100'}
                    ${loading ? 'opacity-40' : ''}`}>
                  {loading && k === '✓' ? '…' : k}
                </button>
              ))}
            </div>

            <div className="mt-4 text-center">
              <button onClick={() => { setStep('select'); setPin(''); setError(null) }} className="text-xs text-slate-400 underline">← เปลี่ยนชื่อ</button>
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
