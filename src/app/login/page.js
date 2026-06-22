'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const auth = useAuth()
  const router = useRouter()

  const [tab, setTab]           = useState('admin') // 'admin' | 'employee'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  // Employee PIN
  const [employees, setEmployees] = useState([])
  const [selEmp, setSelEmp]       = useState(null)  // selected employee
  const [pin, setPin]             = useState('')
  const [pinError, setPinError]   = useState('')

  useEffect(() => {
    if (tab === 'employee') loadEmployees()
  }, [tab])

  async function loadEmployees() {
    const { data } = await supabase.from('employees')
      .select('id,name,position,pin').eq('active', true).eq('can_login', true).order('name')
    setEmployees(data || [])
  }

  async function handleAdminLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError(err.message === 'Invalid login credentials' ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : err.message)
    setLoading(false)
  }

  function handlePinDigit(d) {
    if (pin.length >= 4) return
    const next = pin + d
    setPin(next)
    if (next.length === 4) verifyPin(next)
  }

  function handlePinDelete() { setPin(p => p.slice(0, -1)); setPinError('') }

  async function verifyPin(p) {
    setPinError('')
    if (!selEmp) return
    if (!selEmp.pin) {
      // No PIN set → allow login directly (first time)
      auth.empLogin(selEmp)
      return
    }
    if (p === selEmp.pin) {
      auth.empLogin(selEmp)
    } else {
      setPinError('PIN ไม่ถูกต้อง')
      setPin('')
    }
  }

  const inputStyle = {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.12)',
    fontFamily: 'Sarabun, sans-serif',
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0b1120 0%, #1e1b4b 50%, #0b1120 100%)' }}>

      {/* Background blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute w-96 h-96 rounded-full blur-3xl opacity-30 -top-20 -left-20"
          style={{ background: 'radial-gradient(circle, #3B5BDB, transparent)' }} />
        <div className="absolute w-96 h-96 rounded-full blur-3xl opacity-20 -bottom-20 -right-20"
          style={{ background: 'radial-gradient(circle, #748FFC, transparent)' }} />
      </div>

      <div className="w-full max-w-sm relative z-10 fade-in">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-2xl"
            style={{ background: 'linear-gradient(135deg, #3B5BDB, #4C6EF5)', boxShadow: '0 20px 60px rgba(59,91,219,0.5)' }}>
            <svg viewBox="0 0 24 24" fill="white" className="w-9 h-9">
              <path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/>
            </svg>
          </div>
          <h1 className="font-bold text-3xl text-white tracking-tight">ระบบ POS</h1>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-2xl mb-5"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <button onClick={() => { setTab('admin'); setSelEmp(null); setPin('') }}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab==='admin' ? 'bg-brand text-white shadow-lg' : 'text-white/40 hover:text-white/70'}`}>
            👑 เจ้าของ / Admin
          </button>
          <button onClick={() => setTab('employee')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab==='employee' ? 'bg-emerald-600 text-white shadow-lg' : 'text-white/40 hover:text-white/70'}`}>
            👷 พนักงาน
          </button>
        </div>

        {/* ── Admin Login ── */}
        {tab === 'admin' && (
          <div className="rounded-3xl p-7"
            style={{ background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-white/50 uppercase tracking-widest block mb-2">อีเมล</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com" required autoComplete="email"
                  className="w-full rounded-2xl px-4 py-3.5 text-sm outline-none text-white placeholder-white/25"
                  style={inputStyle}
                  onFocus={e => { e.target.style.background='rgba(59,91,219,0.2)'; e.target.style.borderColor='rgba(59,91,219,0.6)' }}
                  onBlur={e => { e.target.style.background='rgba(255,255,255,0.08)'; e.target.style.borderColor='rgba(255,255,255,0.12)' }} />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/50 uppercase tracking-widest block mb-2">รหัสผ่าน</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" required autoComplete="current-password"
                  className="w-full rounded-2xl px-4 py-3.5 text-sm outline-none text-white placeholder-white/25"
                  style={inputStyle}
                  onFocus={e => { e.target.style.background='rgba(59,91,219,0.2)'; e.target.style.borderColor='rgba(59,91,219,0.6)' }}
                  onBlur={e => { e.target.style.background='rgba(255,255,255,0.08)'; e.target.style.borderColor='rgba(255,255,255,0.12)' }} />
              </div>
              {error && (
                <div className="rounded-2xl px-4 py-3 text-sm" style={{ background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', color:'#fca5a5' }}>
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading}
                className="w-full font-bold py-4 rounded-2xl text-sm text-white disabled:opacity-50 active:scale-[0.98] transition-all"
                style={{ background:'linear-gradient(135deg,#3B5BDB,#4C6EF5)', boxShadow:'0 8px 28px rgba(59,91,219,0.45)' }}>
                {loading ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />กำลังเข้าสู่ระบบ...</span> : 'เข้าสู่ระบบ →'}
              </button>
            </form>
          </div>
        )}

        {/* ── Employee PIN Login ── */}
        {tab === 'employee' && (
          <div className="rounded-3xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.12)' }}>

            {!selEmp ? (
              /* Step 1: Pick employee */
              <div className="p-5">
                <p className="text-white/60 text-sm text-center mb-4">เลือกชื่อของคุณ</p>
                {employees.length === 0 ? (
                  <p className="text-center text-white/30 text-sm py-4">ยังไม่มีพนักงาน<br/><span className="text-xs">แอดมินต้องเพิ่มพนักงานและตั้ง PIN ก่อน</span></p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {employees.map(emp => (
                      <button key={emp.id} onClick={() => { setSelEmp(emp); setPin(''); setPinError('') }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all active:scale-[0.98]"
                        style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)' }}>
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold text-white shrink-0"
                          style={{ background:'linear-gradient(135deg,#059669,#34d399)' }}>
                          {emp.name[0]}
                        </div>
                        <div>
                          <p className="font-semibold text-white text-sm">{emp.name}</p>
                          <p className="text-white/40 text-xs">{emp.position}</p>
                        </div>
                        <span className="ml-auto text-white/30">→</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Step 2: Enter PIN */
              <div className="p-5">
                <div className="flex items-center gap-3 mb-5">
                  <button onClick={() => { setSelEmp(null); setPin('') }}
                    className="text-white/40 hover:text-white/70 text-xl leading-none">←</button>
                  <div className="flex items-center gap-2.5 flex-1">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold text-white shrink-0"
                      style={{ background:'linear-gradient(135deg,#059669,#34d399)' }}>
                      {selEmp.name[0]}
                    </div>
                    <div>
                      <p className="font-semibold text-white text-sm">{selEmp.name}</p>
                      <p className="text-white/40 text-xs">{selEmp.position}</p>
                    </div>
                  </div>
                </div>

                {/* PIN dots */}
                <div className="flex justify-center gap-4 mb-2">
                  {[0,1,2,3].map(i => (
                    <div key={i} className={`w-4 h-4 rounded-full transition-all ${i < pin.length ? 'bg-emerald-400 scale-110' : 'bg-white/20'}`} />
                  ))}
                </div>
                <p className="text-center text-white/40 text-xs mb-4">
                  {!selEmp.pin ? 'ยังไม่มี PIN — กด ✓ เพื่อเข้าใช้งาน' : 'กรอก PIN 4 หลัก'}
                </p>
                {pinError && <p className="text-center text-red-400 text-xs mb-3">{pinError}</p>}

                {/* Numpad */}
                <div className="grid grid-cols-3 gap-2">
                  {[1,2,3,4,5,6,7,8,9].map(d => (
                    <button key={d} onClick={() => handlePinDigit(String(d))}
                      className="py-3.5 rounded-2xl text-xl font-bold text-white active:scale-95 transition-all"
                      style={{ background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.1)' }}>
                      {d}
                    </button>
                  ))}
                  <button onClick={() => { if (!selEmp.pin) auth.empLogin(selEmp) }}
                    className="py-3.5 rounded-2xl text-white active:scale-95 transition-all"
                    style={{ background: !selEmp.pin ? 'rgba(16,185,129,0.3)' : 'transparent' }}>
                    {!selEmp.pin ? <span className="text-emerald-400 font-bold">✓</span> : ''}
                  </button>
                  <button onClick={() => handlePinDigit('0')}
                    className="py-3.5 rounded-2xl text-xl font-bold text-white active:scale-95 transition-all"
                    style={{ background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.1)' }}>
                    0
                  </button>
                  <button onClick={handlePinDelete}
                    className="py-3.5 rounded-2xl text-white/50 active:scale-95 transition-all text-lg"
                    style={{ background:'rgba(255,255,255,0.05)' }}>
                    ⌫
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-xs text-white/25 mt-5">ติดต่อผู้ดูแลระบบเพื่อขอรหัสผ่าน</p>
      </div>
    </div>
  )
}
