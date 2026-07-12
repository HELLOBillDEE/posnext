'use client'
import { useState, useEffect } from 'react'

const KEYS    = ['1','2','3','4','5','6','7','8','9','⌫','0','✓']
const PALETTE = ['bg-brand','bg-blue-500','bg-emerald-500','bg-amber-500','bg-purple-500','bg-pink-500']
const STATUS  = {
  pending:   { label:'รออนุมัติ', cls:'bg-amber-100 text-amber-700' },
  approved:  { label:'อนุมัติแล้ว', cls:'bg-green-100 text-green-700' },
  rejected:  { label:'ไม่อนุมัติ', cls:'bg-red-100 text-red-700' },
  cancelled: { label:'ยกเลิกแล้ว', cls:'bg-slate-100 text-slate-400' },
}
const PERIOD_LABEL = { full:'เต็มวัน', morning:'เช้า', afternoon:'บ่าย' }

const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone:'Asia/Bangkok' })
const fmtTime  = iso => iso ? new Date(iso).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}) : '—'
const fmtDate  = d   => d   ? new Date(d+'T00:00:00').toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : ''
const fmtMoney = n   => Number(n).toLocaleString('th-TH')

function Badge({ status }) {
  const s = STATUS[status] || { label: status, cls:'bg-slate-100 text-slate-500' }
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
}

function Numpad({ onKey, confirmDisabled, loading }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {KEYS.map(k => (
        <button key={k} onClick={() => onKey(k)} disabled={loading}
          className={`h-16 rounded-2xl text-2xl font-bold transition-all active:scale-95 select-none shadow-sm
            ${k==='✓' ? confirmDisabled ? 'bg-slate-200 text-slate-400' : 'bg-brand text-white shadow-md'
              : k==='⌫' ? 'bg-slate-200 text-slate-600' : 'bg-white text-slate-800 border border-slate-100'}
            ${loading ? 'opacity-40' : ''}`}>
          {loading && k==='✓' ? '…' : k}
        </button>
      ))}
    </div>
  )
}

export default function StaffPage() {
  /* auth */
  const [step,       setStep]       = useState('loading')
  const [session,    setSession]    = useState(null)
  const [authErr,    setAuthErr]    = useState(null)
  const [authLoad,   setAuthLoad]   = useState(false)
  /* login form */
  const [loginPhone, setLoginPhone] = useState('')
  const [loginPw,    setLoginPw]    = useState('')
  /* dashboard */
  const [data,       setData]       = useState(null)
  const [tab,        setTab]        = useState('home')
  const [actionLoad, setActionLoad] = useState(false)
  const [actionMsg,  setActionMsg]  = useState(null)
  /* leave form */
  const [dateFrom,     setDateFrom]     = useState(todayStr())
  const [dateTo,       setDateTo]       = useState(todayStr())
  const [leavePeriod,  setLeavePeriod]  = useState('full')
  const [leaveNote,    setLeaveNote]    = useState('')
  const [leaveLoad,    setLeaveLoad]    = useState(false)
  const [leaveMsg,     setLeaveMsg]     = useState(null)
  /* advance form */
  const [amount,     setAmount]     = useState('')
  const [advLoad,    setAdvLoad]    = useState(false)
  const [advMsg,     setAdvMsg]     = useState(null)
  /* drawer request */
  const [drawerLoad, setDrawerLoad] = useState(false)
  const [drawerMsg,  setDrawerMsg]  = useState(null)
  /* self-registration */
  const [regName,    setRegName]    = useState('')
  const [regNick,    setRegNick]    = useState('')
  const [regPhone,   setRegPhone]   = useState('')
  const [regPw,      setRegPw]      = useState('')
  const [regPw2,     setRegPw2]     = useState('')
  const [regPin,     setRegPin]     = useState('')
  const [regPin2,    setRegPin2]    = useState('')
  const [regLoad,    setRegLoad]    = useState(false)
  const [regErr,     setRegErr]     = useState(null)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('staff_session') || 'null')
      if (saved?.employee_id && saved?.password) loadDashboard(saved)
      else setStep('login')
    } catch { setStep('login') }
  }, [])

  async function loadDashboard(sess) {
    setStep('loading')
    try {
      const res  = await fetch('/api/my', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ employee_id: sess.employee_id, password: sess.password }),
      })
      const json = await res.json()
      if (json.error) { localStorage.removeItem('staff_session'); setStep('login'); return }
      setSession(sess); setData(json); setStep('dashboard')
    } catch { setStep('login') }
  }

  async function doLogin() {
    if (!loginPhone.trim() || !loginPw.trim()) { setAuthErr('กรุณากรอกเบอร์โทรและรหัสผ่าน'); return }
    setAuthLoad(true); setAuthErr(null)
    try {
      const res  = await fetch('/api/staff-login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ phone: loginPhone.trim(), password: loginPw.trim() }),
      })
      const json = await res.json()
      if (json.error) { setAuthErr(json.error); return }
      const sess = { employee_id: json.employee.id, password: loginPw.trim() }
      try {
        localStorage.setItem('staff_session', JSON.stringify(sess))
        localStorage.setItem('staff_device_owner', JSON.stringify({
          employee_id: json.employee.id, name: json.employee.name,
          nickname: json.employee.nickname, colorIdx: 0,
        }))
      } catch {}
      setSession(sess); setLoginPhone(''); setLoginPw('')
      await loadDashboard(sess)
    } catch { setAuthErr('เชื่อมต่อไม่ได้') }
    finally { setAuthLoad(false) }
  }

  function doLogout() {
    try { localStorage.removeItem('staff_session') } catch {}
    setSession(null); setData(null); setAuthErr(null); setTab('home'); setStep('login')
  }

  async function refreshData() {
    if (!session) return
    const res  = await fetch('/api/my', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ employee_id: session.employee_id, password: session.password }),
    })
    const json = await res.json()
    if (!json.error) setData(json)
  }

  /* check-in / check-out */
  async function doAttendance() {
    if (!session || actionLoad) return
    setActionLoad(true); setActionMsg(null)
    try {
      const res  = await fetch('/api/checkin', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ employee_id: session.employee_id, password: session.password }),
      })
      const json = await res.json()
      if (json.error) { setActionMsg({ ok:false, text: json.error }); return }
      setActionMsg({
        ok: true,
        text: json.action==='in'  ? `บันทึกเข้างาน ${fmtTime(json.time)}` :
              json.action==='out' ? `บันทึกออกงาน ${fmtTime(json.time)}` : 'บันทึกครบแล้ววันนี้'
      })
      await refreshData()
    } catch { setActionMsg({ ok:false, text:'เชื่อมต่อไม่ได้' }) }
    finally { setActionLoad(false); setTimeout(() => setActionMsg(null), 3000) }
  }

  /* leave submit */
  async function doLeave() {
    if (!session || leaveLoad) return
    setLeaveLoad(true); setLeaveMsg(null)
    try {
      const res  = await fetch('/api/leave', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          employee_id: session.employee_id, password: session.password,
          leave_type: 'holiday',
          date_from: dateFrom,
          date_to: leavePeriod !== 'full' ? dateFrom : dateTo,
          leave_period: leavePeriod,
          note: leaveNote,
        }),
      })
      const json = await res.json()
      if (json.error) { setLeaveMsg({ ok:false, text: json.error }); return }
      setLeaveMsg({ ok:true, text:'ส่งคำขอลาแล้ว รอ admin อนุมัติ' })
      setDateFrom(todayStr()); setDateTo(todayStr()); setLeaveNote(''); setLeavePeriod('full')
      await refreshData()
    } catch { setLeaveMsg({ ok:false, text:'เชื่อมต่อไม่ได้' }) }
    finally { setLeaveLoad(false) }
  }

  /* cancel leave */
  async function doCancelLeave(leaveId) {
    if (!session) return
    try {
      const res  = await fetch('/api/cancel-leave', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ leave_id: leaveId, employee_id: session.employee_id, password: session.password }),
      })
      const json = await res.json()
      if (json.error) alert(json.error)
      else await refreshData()
    } catch { alert('เชื่อมต่อไม่ได้') }
  }

  /* advance submit */
  async function doAdvance() {
    if (!amount || !session || advLoad) return
    setAdvLoad(true); setAdvMsg(null)
    try {
      const res  = await fetch('/api/advance', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ employee_id: session.employee_id, password: session.password, amount: Number(amount) }),
      })
      const json = await res.json()
      if (json.error) { setAdvMsg({ ok:false, text: json.error }); return }
      setAdvMsg({ ok:true, text:`ส่งคำขอเบิก ฿${fmtMoney(json.amount)} แล้ว` })
      setAmount('')
      await refreshData()
    } catch { setAdvMsg({ ok:false, text:'เชื่อมต่อไม่ได้' }) }
    finally { setAdvLoad(false) }
  }

  /* cancel advance */
  async function doCancelAdvance(advId) {
    if (!session) return
    try {
      const res  = await fetch('/api/cancel-advance', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ advance_id: advId, employee_id: session.employee_id, password: session.password }),
      })
      const json = await res.json()
      if (json.error) alert(json.error)
      else await refreshData()
    } catch { alert('เชื่อมต่อไม่ได้') }
  }

  async function doDrawerRequest() {
    if (!session || drawerLoad) return
    setDrawerLoad(true); setDrawerMsg(null)
    try {
      const res  = await fetch('/api/request-drawer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: session.employee_id, password: session.password }),
      })
      const json = await res.json()
      if (json.error) { setDrawerMsg({ ok: false, text: json.error }); return }
      setDrawerMsg({ ok: true, text: 'ส่งคำขอแล้ว รอ admin อนุมัติ ทาง Telegram' })
      setTimeout(() => setDrawerMsg(null), 6000)
    } catch { setDrawerMsg({ ok: false, text: 'เชื่อมต่อไม่ได้' }) }
    finally { setDrawerLoad(false) }
  }

  async function doRegister() {
    if (!regName.trim())   return setRegErr('กรุณากรอกชื่อ')
    if (!regPhone.trim())  return setRegErr('กรุณากรอกเบอร์โทรศัพท์')
    if (!regPw.trim())     return setRegErr('กรุณาตั้งรหัสผ่าน')
    if (regPw !== regPw2)  return setRegErr('รหัสผ่านไม่ตรงกัน')
    if (regPin.length < 4) return setRegErr('PIN ต้องมีอย่างน้อย 4 หลัก')
    if (regPin !== regPin2) return setRegErr('PIN ไม่ตรงกัน')
    setRegLoad(true); setRegErr(null)
    try {
      const res = await fetch('/api/staff-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: regName.trim(), nickname: regNick.trim(), phone: regPhone.trim(), password: regPw.trim(), pin: regPin }),
      })
      const json = await res.json()
      if (!res.ok) return setRegErr(json.error || 'สมัครไม่ได้')
      const newSession = { employee_id: json.employee.id, password: regPw.trim() }
      localStorage.setItem('staff_device_owner', JSON.stringify({ employee_id: json.employee.id, nickname: json.employee.nickname, name: json.employee.name, colorIdx: 0 }))
      localStorage.setItem('staff_session', JSON.stringify(newSession))
      setSession(newSession)
      await loadDashboard(newSession)
    } catch (e) {
      setRegErr(e.message)
    } finally {
      setRegLoad(false)
    }
  }

  function pressAmount(k) {
    if (advLoad) return
    if (k==='⌫') { setAmount(a => a.slice(0,-1)); return }
    if (k==='✓') { doAdvance(); return }
    if (amount.length >= 6) return
    setAmount(a => a + k)
  }

  const colorIdx = 0
  const emp      = data?.employee

  /* ── loading ── */
  if (step === 'loading') return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 text-sm">กำลังโหลด…</p>
      </div>
    </div>
  )

  /* ── LOGIN ── */
  if (step === 'login') return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-xs">
        <div className="text-center mb-8">
          <p className="text-3xl mb-2">🔐</p>
          <p className="text-xl font-bold text-slate-700 font-heading">เข้าสู่ระบบ</p>
          <p className="text-sm text-slate-400 mt-1">ใช้เบอร์โทรและรหัสผ่านของคุณ</p>
        </div>
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">เบอร์โทรศัพท์</label>
            <input value={loginPhone} onChange={e => setLoginPhone(e.target.value)} onKeyDown={e => e.key==='Enter' && doLogin()}
              type="tel" inputMode="tel" placeholder="08X-XXX-XXXX" autoComplete="username"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">รหัสผ่าน</label>
            <input value={loginPw} onChange={e => setLoginPw(e.target.value)} onKeyDown={e => e.key==='Enter' && doLogin()}
              type="password" placeholder="รหัสผ่าน" autoComplete="current-password"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand" />
          </div>
          {authErr && <p className="text-red-500 text-xs text-center font-semibold">❌ {authErr}</p>}
          <button onClick={doLogin} disabled={authLoad}
            className="w-full py-3 rounded-2xl bg-brand text-white font-bold text-sm shadow disabled:opacity-40 active:scale-95 transition-all">
            {authLoad ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ →'}
          </button>
        </div>
        <div className="mt-5 text-center">
          <button onClick={() => { setRegName(''); setRegNick(''); setRegPhone(''); setRegPw(''); setRegPw2(''); setRegPin(''); setRegPin2(''); setRegErr(null); setStep('register') }}
            className="text-xs text-brand underline font-semibold">
            + สมัครพนักงานใหม่
          </button>
        </div>
      </div>
    </div>
  )

  /* ── REGISTER ── */
  if (step === 'register') return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-xs">
        <div className="text-center mb-6">
          <p className="text-3xl mb-2">✍️</p>
          <p className="text-xl font-bold text-slate-700 font-heading">สมัครพนักงานใหม่</p>
          <p className="text-sm text-slate-400 mt-1">ระบบจะแจ้งเจ้าของร้านทาง Telegram</p>
        </div>
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">ชื่อ-นามสกุล *</label>
            <input value={regName} onChange={e => setRegName(e.target.value)}
              placeholder="ชื่อจริง"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">ชื่อเล่น</label>
            <input value={regNick} onChange={e => setRegNick(e.target.value)}
              placeholder="ชื่อเล่น (ไม่บังคับ)"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">เบอร์โทรศัพท์ * (ใช้ login)</label>
            <input value={regPhone} onChange={e => setRegPhone(e.target.value)}
              type="tel" inputMode="tel" placeholder="08X-XXX-XXXX"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">รหัสผ่าน *</label>
            <input value={regPw} onChange={e => setRegPw(e.target.value)}
              type="password" placeholder="ตั้งรหัสผ่าน"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">ยืนยันรหัสผ่าน *</label>
            <input value={regPw2} onChange={e => setRegPw2(e.target.value)}
              type="password" placeholder="พิมอีกครั้ง"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand" />
          </div>
          <div className="pt-1 border-t border-slate-100">
            <label className="text-xs font-semibold text-slate-500 block mb-1">PIN 4 หลัก * <span className="font-normal text-slate-400">(ใช้ยืนยันการลา/เบิก)</span></label>
            <input value={regPin} onChange={e => setRegPin(e.target.value.replace(/\D/g,'').slice(0,6))}
              type="password" inputMode="numeric" placeholder="••••"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand tracking-widest" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">ยืนยัน PIN *</label>
            <input value={regPin2} onChange={e => setRegPin2(e.target.value.replace(/\D/g,'').slice(0,6))}
              type="password" inputMode="numeric" placeholder="••••"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand tracking-widest" />
          </div>
          {regErr && <p className="text-red-500 text-xs text-center font-semibold">❌ {regErr}</p>}
          <button onClick={doRegister} disabled={regLoad}
            className="w-full py-3 rounded-2xl bg-brand text-white font-bold text-sm shadow disabled:opacity-40 active:scale-95 transition-all">
            {regLoad ? 'กำลังสมัคร…' : 'สมัครเลย →'}
          </button>
        </div>
        <div className="mt-4 text-center">
          <button onClick={() => setStep('login')} className="text-xs text-slate-400 underline">← กลับ</button>
        </div>
      </div>
    </div>
  )

  /* ── DASHBOARD ── */
  const today     = data?.today
  const hasIn     = !!today?.check_in
  const hasOut    = !!today?.check_out
  const pendLeave = (data?.leaves||[]).filter(l => l.status==='pending').length
  const pendAdv   = (data?.advances||[]).filter(a => a.status==='pending').length

  // merged history: attendance + leave + advance, sorted by date desc
  const historyItems = [
    ...(data?.recentAtt||[]).map(a => ({ _type:'att', _date: a.date, ...a })),
    ...(data?.leaves||[]).filter(l => l.status !== 'cancelled').map(l => ({ _type:'leave', _date: l.date_from, ...l })),
    ...(data?.advances||[]).filter(a => a.status !== 'cancelled').map(a => ({ _type:'adv', _date: a.requested_at?.slice(0,10), ...a })),
  ].sort((a, b) => (b._date||'').localeCompare(a._date||''))

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      {/* Header */}
      <div className="bg-brand text-white px-5 pt-10 pb-16">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold text-lg">
              {(emp?.nickname || emp?.name || '').charAt(0)}
            </div>
            <div>
              <p className="font-bold text-lg leading-tight">{emp?.nickname || emp?.name}</p>
              <p className="text-white/70 text-xs">{emp?.position || 'พนักงาน'}</p>
            </div>
          </div>
          <button onClick={doLogout} className="text-white/60 text-xs border border-white/30 rounded-full px-3 py-1">ออกจากระบบ</button>
        </div>
      </div>

      {/* Today card */}
      <div className="px-4 -mt-10">
        <div className="bg-white rounded-3xl shadow-md p-5 mb-4">
          <p className="text-xs text-slate-400 font-semibold mb-3">
            {new Date().toLocaleDateString('th-TH',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
          </p>
          <div className="flex gap-6 mb-4">
            <div>
              <p className="text-xs text-slate-400">เข้างาน</p>
              <p className={`text-xl font-bold ${hasIn ? 'text-green-600' : 'text-slate-300'}`}>{hasIn ? fmtTime(today.check_in) : '—:——'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">ออกงาน</p>
              <p className={`text-xl font-bold ${hasOut ? 'text-blue-600' : 'text-slate-300'}`}>{hasOut ? fmtTime(today.check_out) : '—:——'}</p>
            </div>
          </div>
          {actionMsg ? (
            <div className={`rounded-2xl py-3 text-center text-sm font-semibold ${actionMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              {actionMsg.ok ? '✅' : '❌'} {actionMsg.text}
            </div>
          ) : hasOut ? (
            <div className="bg-slate-100 rounded-2xl py-3 text-center text-sm text-slate-400 font-semibold">✅ บันทึกครบแล้ววันนี้</div>
          ) : (
            <button onClick={doAttendance} disabled={actionLoad}
              className={`w-full py-3 rounded-2xl font-bold text-white text-sm shadow-sm active:scale-95 transition-all disabled:opacity-40
                ${hasIn ? 'bg-blue-500' : 'bg-green-500'}`}>
              {actionLoad ? '…' : hasIn ? '🏠 บันทึกออกงาน' : '👋 บันทึกเข้างาน'}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-4 gap-1.5 mb-4">
          {[
            { id:'home',    label:'หน้าหลัก' },
            { id:'leave',   label:`ลา${pendLeave ? ` (${pendLeave})` : ''}` },
            { id:'advance', label:`เบิก${pendAdv ? ` (${pendAdv})` : ''}` },
            { id:'history', label:'ประวัติ' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`py-2 rounded-xl text-xs font-semibold transition-all ${tab===t.id ? 'bg-brand text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: หน้าหลัก */}
        {tab==='home' && (
          <div className="space-y-3">
            {/* ขอเปิดลิ้นชัก */}
            <div className="bg-white rounded-2xl border border-slate-100 px-4 py-3">
              <button onClick={doDrawerRequest} disabled={drawerLoad}
                className="w-full py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 font-semibold text-sm active:bg-amber-100 disabled:opacity-40 transition-all">
                {drawerLoad ? '⏳ กำลังส่งคำขอ…' : '🔓 ขอเปิดลิ้นชัก'}
              </button>
              {drawerMsg && (
                <p className={`text-xs font-semibold text-center mt-2 ${drawerMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {drawerMsg.ok ? '✅' : '❌'} {drawerMsg.text}
                </p>
              )}
            </div>
            {(data?.recentAtt||[]).slice(0,7).map((a,i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    {new Date(a.date+'T00:00:00').toLocaleDateString('th-TH',{weekday:'short',day:'numeric',month:'short'})}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    เข้า {fmtTime(a.check_in)}{a.check_out ? ` · ออก ${fmtTime(a.check_out)}` : ' · ยังไม่ออก'}
                  </p>
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">มา</span>
              </div>
            ))}
            {(data?.recentAtt||[]).length===0 && <p className="text-center text-slate-300 py-8 text-sm">ยังไม่มีประวัติเข้างาน</p>}
          </div>
        )}

        {/* Tab: ลา */}
        {tab==='leave' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <p className="font-semibold text-slate-700 text-sm">แจ้งลาใหม่</p>

              {/* ช่วงลา */}
              <div>
                <p className="text-xs text-slate-400 mb-1.5">ช่วงเวลา</p>
                <div className="flex gap-2">
                  {[
                    { v:'full',      label:'เต็มวัน' },
                    { v:'morning',   label:'เช้า' },
                    { v:'afternoon', label:'บ่าย' },
                  ].map(({ v, label }) => (
                    <button key={v} onClick={() => setLeavePeriod(v)}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all
                        ${leavePeriod===v ? 'bg-brand text-white border-brand' : 'bg-white text-slate-500 border-slate-200'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-slate-400 mb-1">วันที่</p>
                <input type="date" value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); if (e.target.value > dateTo) setDateTo(e.target.value) }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
              </div>

              {leavePeriod==='full' && (
                <div>
                  <p className="text-xs text-slate-400 mb-1">ถึงวันที่</p>
                  <input type="date" value={dateTo} min={dateFrom}
                    onChange={e => setDateTo(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-brand outline-none" />
                </div>
              )}

              <textarea value={leaveNote} onChange={e => setLeaveNote(e.target.value)}
                placeholder="หมายเหตุ เช่น ป่วย, ธุระ, นัดหมอ…" rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:border-brand outline-none" />

              {leaveMsg && (
                <p className={`text-sm font-semibold text-center ${leaveMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {leaveMsg.ok ? '✅' : '❌'} {leaveMsg.text}
                </p>
              )}
              <button onClick={doLeave} disabled={leaveLoad}
                className="w-full bg-brand text-white font-bold py-3 rounded-xl active:scale-95 transition-all disabled:opacity-40">
                {leaveLoad ? 'กำลังส่ง…' : '📨 ส่งคำขอลา'}
              </button>
            </div>

            {/* รายการลา */}
            {(data?.leaves||[]).map(l => (
              <div key={l.id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-700">
                        {fmtDate(l.date_from)}{l.date_to!==l.date_from ? ` – ${fmtDate(l.date_to)}` : ''}
                      </p>
                      {l.leave_period && l.leave_period !== 'full' && (
                        <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-semibold">
                          {PERIOD_LABEL[l.leave_period]}
                        </span>
                      )}
                    </div>
                    {l.note && <p className="text-xs text-slate-400 mt-0.5">{l.note}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge status={l.status} />
                    {l.status==='pending' && (
                      <button onClick={() => doCancelLeave(l.id)}
                        className="text-xs text-red-400 border border-red-200 rounded-full px-2 py-0.5 hover:bg-red-50">
                        ยกเลิก
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {(data?.leaves||[]).length===0 && <p className="text-center text-slate-300 py-4 text-sm">ยังไม่มีประวัติการลา</p>}
          </div>
        )}

        {/* Tab: เบิก */}
        {tab==='advance' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
              <p className="font-semibold text-slate-700 text-sm">ส่งคำขอเบิกเงิน</p>
              <div className="bg-slate-50 rounded-2xl py-4 text-center border border-slate-100">
                <p className="text-4xl font-bold text-amber-600">
                  {amount ? `฿${fmtMoney(Number(amount))}` : <span className="text-slate-300">฿0</span>}
                </p>
              </div>
              <Numpad onKey={pressAmount} confirmDisabled={!amount || amount==='0'} loading={advLoad} />
              {advMsg && (
                <p className={`text-sm font-semibold text-center ${advMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {advMsg.ok ? '✅' : '❌'} {advMsg.text}
                </p>
              )}
            </div>

            {(data?.advances||[]).map(a => (
              <div key={a.id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xl font-bold text-amber-600">฿{fmtMoney(a.amount)}</p>
                  {a.note && <p className="text-xs text-slate-400">{a.note}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge status={a.status} />
                  {a.status==='pending' && (
                    <button onClick={() => doCancelAdvance(a.id)}
                      className="text-xs text-red-400 border border-red-200 rounded-full px-2 py-0.5 hover:bg-red-50">
                      ยกเลิก
                    </button>
                  )}
                </div>
              </div>
            ))}
            {(data?.advances||[]).length===0 && <p className="text-center text-slate-300 py-4 text-sm">ยังไม่มีประวัติการเบิก</p>}
          </div>
        )}

        {/* Tab: ประวัติ (รวม) */}
        {tab==='history' && (
          <div className="space-y-2">
            {historyItems.length===0 && <p className="text-center text-slate-300 py-8 text-sm">ยังไม่มีประวัติ</p>}
            {historyItems.map((item, i) => {
              if (item._type==='att') return (
                <div key={`att-${i}`} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">
                      {new Date(item.date+'T00:00:00').toLocaleDateString('th-TH',{weekday:'short',day:'numeric',month:'short'})}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      เข้า {fmtTime(item.check_in)}{item.check_out ? ` · ออก ${fmtTime(item.check_out)}` : ' · ยังไม่ออก'}
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">มา</span>
                </div>
              )
              if (item._type==='leave') return (
                <div key={`leave-${item.id}`} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-700">
                        🏖 {fmtDate(item.date_from)}{item.date_to!==item.date_from ? ` – ${fmtDate(item.date_to)}` : ''}
                      </p>
                      {item.leave_period && item.leave_period !== 'full' && (
                        <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">{PERIOD_LABEL[item.leave_period]}</span>
                      )}
                    </div>
                    {item.note && <p className="text-xs text-slate-400 mt-0.5">{item.note}</p>}
                  </div>
                  <Badge status={item.status} />
                </div>
              )
              if (item._type==='adv') return (
                <div key={`adv-${item.id}`} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">💵 เบิก ฿{fmtMoney(item.amount)}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{fmtDate(item._date)}</p>
                  </div>
                  <Badge status={item.status} />
                </div>
              )
              return null
            })}
          </div>
        )}
      </div>
    </div>
  )
}
