'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { hasPinCredentials, decryptPinCredentials } from '@/lib/pinAuth'

export default function LoginPage() {
  const [mode, setMode]       = useState('form') // 'form' | 'pin'
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  // PIN mode
  const [pin, setPin]         = useState('')
  const [pinError, setPinError] = useState('')
  const [hasPin, setHasPin]   = useState(false)

  useEffect(() => {
    const hp = hasPinCredentials()
    setHasPin(hp)
    if (hp) setMode('pin')
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError(err.message === 'Invalid login credentials' ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : err.message)
    setLoading(false)
  }

  async function handlePinDigit(d) {
    const next = pin + d
    setPin(next)
    setPinError('')
    if (next.length < 6) return
    setLoading(true)
    const creds = await decryptPinCredentials(next)
    if (!creds) {
      setPinError('PIN ไม่ถูกต้อง ลองใหม่')
      setPin('')
      setLoading(false)
      return
    }
    const { error: err } = await supabase.auth.signInWithPassword(creds)
    if (err) {
      setPinError('เข้าระบบไม่ได้: ' + err.message)
      setPin('')
    }
    setLoading(false)
  }

  function handlePinDelete() {
    setPin(p => p.slice(0, -1))
    setPinError('')
  }

  const inputStyle = {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.12)',
    fontFamily: 'Kanit, sans-serif',
    touchAction: 'manipulation',
  }

  return (
    <div style={{
      minHeight: '100svh',
      background: 'linear-gradient(135deg, #14060a 0%, #2D142C 50%, #14060a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-2xl"
            style={{ background: 'transparent', boxShadow: '0 20px 60px rgba(199,44,65,0.4)' }}>
            <img src="/logo.png" alt="CHERD" className="w-20 h-20 rounded-3xl object-cover" />
          </div>
          <h1 className="font-bold text-3xl text-white tracking-tight">CHERD.</h1>
          <p className="text-white/40 text-sm mt-2">เข้าสู่ระบบเพื่อดำเนินการต่อ</p>
        </div>

        {mode === 'pin' ? (
          <div className="rounded-3xl p-7"
            style={{ background: 'rgba(30,10,20,0.85)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 32px 64px rgba(0,0,0,0.5)' }}>

            <p className="text-center text-white/60 text-sm mb-5">กรอก PIN 6 หลัก</p>

            {/* Dots */}
            <div className="flex justify-center gap-3 mb-6">
              {[0,1,2,3,4,5].map(i => (
                <div key={i} className={`w-3.5 h-3.5 rounded-full transition-all ${i < pin.length ? 'bg-red-400 scale-110' : 'bg-white/20'}`} />
              ))}
            </div>

            {pinError && (
              <p className="text-center text-red-400 text-sm mb-4">{pinError}</p>
            )}

            {/* Number pad */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[1,2,3,4,5,6,7,8,9].map(d => (
                <button key={d} onClick={() => !loading && handlePinDigit(String(d))}
                  disabled={loading || pin.length >= 6}
                  className="py-4 rounded-2xl text-2xl font-bold text-white active:scale-95 transition-all disabled:opacity-40"
                  style={{ background: 'rgba(255,255,255,0.1)', touchAction: 'manipulation' }}>
                  {d}
                </button>
              ))}
              <div />
              <button onClick={() => !loading && handlePinDigit('0')}
                disabled={loading || pin.length >= 6}
                className="py-4 rounded-2xl text-2xl font-bold text-white active:scale-95 transition-all disabled:opacity-40"
                style={{ background: 'rgba(255,255,255,0.1)', touchAction: 'manipulation' }}>
                0
              </button>
              <button onClick={handlePinDelete}
                disabled={loading || pin.length === 0}
                className="py-4 rounded-2xl text-2xl text-white/60 active:scale-95 transition-all disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.06)', touchAction: 'manipulation' }}>
                ⌫
              </button>
            </div>

            {loading && (
              <p className="text-center text-white/40 text-sm">กำลังเข้าระบบ...</p>
            )}

            <button onClick={() => { setMode('form'); setPin(''); setPinError('') }}
              className="w-full text-center text-white/30 text-xs mt-2 py-2 active:text-white/60"
              style={{ touchAction: 'manipulation' }}>
              ใช้อีเมล / รหัสผ่านแทน
            </button>
          </div>
        ) : (
          <div className="rounded-3xl p-7"
            style={{ background: 'rgba(30,10,20,0.85)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 32px 64px rgba(0,0,0,0.5)' }}>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-white/50 uppercase tracking-widest block mb-2">อีเมล</label>
                <input type="text" inputMode="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com" required autoComplete="email"
                  className="w-full rounded-2xl px-4 py-3.5 text-sm outline-none text-white placeholder-white/25 focus:ring-2 focus:ring-red-500/50"
                  style={inputStyle} />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/50 uppercase tracking-widest block mb-2">รหัสผ่าน</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" required autoComplete="current-password"
                  className="w-full rounded-2xl px-4 py-3.5 text-sm outline-none text-white placeholder-white/25 focus:ring-2 focus:ring-red-500/50"
                  style={inputStyle} />
              </div>
              {error && (
                <div className="rounded-2xl px-4 py-3 text-sm flex items-center gap-2"
                  style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading}
                className="w-full font-bold py-4 rounded-2xl text-sm text-white disabled:opacity-50 active:scale-[0.98] transition-all mt-1"
                style={{ background: 'linear-gradient(135deg, #C72C41, #EE4540)', boxShadow: '0 8px 28px rgba(199,44,65,0.45)', touchAction: 'manipulation' }}>
                {loading
                  ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />กำลังเข้าสู่ระบบ...</span>
                  : 'เข้าสู่ระบบ →'}
              </button>
            </form>
            {hasPin && (
              <button onClick={() => { setMode('pin'); setError('') }}
                className="w-full text-center text-white/30 text-xs mt-4 py-2 active:text-white/60"
                style={{ touchAction: 'manipulation' }}>
                ← ใช้ PIN แทน
              </button>
            )}
          </div>
        )}

        <p className="text-center text-xs text-white/25 mt-6">ติดต่อผู้ดูแลระบบเพื่อขอรหัสผ่าน</p>
      </div>
    </div>
  )
}
