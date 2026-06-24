'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError(err.message === 'Invalid login credentials' ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : err.message)
    setLoading(false)
  }

  const inputStyle = {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.12)',
    fontFamily: 'Kanit, sans-serif',
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #14060a 0%, #2D142C 50%, #14060a 100%)' }}>
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute w-96 h-96 rounded-full blur-3xl opacity-30 -top-20 -left-20"
          style={{ background: 'radial-gradient(circle, #C72C41, transparent)' }} />
        <div className="absolute w-96 h-96 rounded-full blur-3xl opacity-20 -bottom-20 -right-20"
          style={{ background: 'radial-gradient(circle, #EE4540, transparent)' }} />
      </div>

      <div className="w-full max-w-sm relative z-10 fade-in">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-2xl"
            style={{ background: 'transparent', boxShadow: '0 20px 60px rgba(199,44,65,0.4)' }}>
            <img src="/logo.png" alt="CHERD" className="w-20 h-20 rounded-3xl object-cover" />
          </div>
          <h1 className="font-bold text-3xl text-white tracking-tight">CHERD.</h1>
          <p className="text-white/40 text-sm mt-2">เข้าสู่ระบบเพื่อดำเนินการต่อ</p>
        </div>

        <div className="rounded-3xl p-7"
          style={{ background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 32px 64px rgba(0,0,0,0.3)' }}>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-white/50 uppercase tracking-widest block mb-2">อีเมล</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com" required autoComplete="email"
                className="w-full rounded-2xl px-4 py-3.5 text-sm outline-none text-white placeholder-white/25"
                style={inputStyle}
                onFocus={e => { e.target.style.background='rgba(199,44,65,0.2)'; e.target.style.borderColor='rgba(199,44,65,0.6)' }}
                onBlur={e => { e.target.style.background='rgba(255,255,255,0.08)'; e.target.style.borderColor='rgba(255,255,255,0.12)' }} />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/50 uppercase tracking-widest block mb-2">รหัสผ่าน</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required autoComplete="current-password"
                className="w-full rounded-2xl px-4 py-3.5 text-sm outline-none text-white placeholder-white/25"
                style={inputStyle}
                onFocus={e => { e.target.style.background='rgba(199,44,65,0.2)'; e.target.style.borderColor='rgba(199,44,65,0.6)' }}
                onBlur={e => { e.target.style.background='rgba(255,255,255,0.08)'; e.target.style.borderColor='rgba(255,255,255,0.12)' }} />
            </div>
            {error && (
              <div className="rounded-2xl px-4 py-3 text-sm flex items-center gap-2"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
                {error}
              </div>
            )}
            <button type="submit" disabled={loading}
              className="w-full font-bold py-4 rounded-2xl text-sm text-white disabled:opacity-50 active:scale-[0.98] transition-all mt-1"
              style={{ background: 'linear-gradient(135deg, #C72C41, #EE4540)', boxShadow: '0 8px 28px rgba(199,44,65,0.45)' }}>
              {loading
                ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />กำลังเข้าสู่ระบบ...</span>
                : 'เข้าสู่ระบบ →'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-white/25 mt-6">ติดต่อผู้ดูแลระบบเพื่อขอรหัสผ่าน</p>
      </div>
    </div>
  )
}
