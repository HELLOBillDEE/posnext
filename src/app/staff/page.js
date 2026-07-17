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
  const [showAdvForm, setShowAdvForm] = useState(false)
  /* salary tab */
  const [salaryData,   setSalaryData]   = useState(null)
  const [salaryLoad,   setSalaryLoad]   = useState(false)
  const [salaryPeriod, setSalaryPeriod] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7))
  /* drawer request */
  const [drawerLoad, setDrawerLoad] = useState(false)
  const [drawerMsg,  setDrawerMsg]  = useState(null)
  /* profile edit */
  const [profName,   setProfName]   = useState('')
  const [profNick,   setProfNick]   = useState('')
  const [profPhone,  setProfPhone]  = useState('')
  const [profPw,     setProfPw]     = useState('')
  const [profPw2,    setProfPw2]    = useState('')
  const [profPin,    setProfPin]    = useState('')
  const [profPin2,   setProfPin2]   = useState('')
  const [profLoad,   setProfLoad]   = useState(false)
  const [profMsg,    setProfMsg]    = useState(null)
  /* announcements */
  const [announcements, setAnnouncements] = useState([])
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
    const ctrl = new AbortController()
    const tid  = setTimeout(() => ctrl.abort(), 10000)
    try {
      const res  = await fetch('/api/my', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ employee_id: sess.employee_id, password: sess.password }),
        signal: ctrl.signal,
      })
      clearTimeout(tid)
      const json = await res.json()
      if (json.error) { localStorage.removeItem('staff_session'); setStep('login'); return }
      setSession(sess); setData(json); setStep('dashboard')
      fetch('/api/announcements').then(r => r.json()).then(list => { if (Array.isArray(list)) setAnnouncements(list) }).catch(() => {})
      loadSalary(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7))
    } catch { clearTimeout(tid); setStep('login') }
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

  function openProfileTab(emp) {
    setProfName(emp?.name || '')
    setProfNick(emp?.nickname || '')
    setProfPhone(emp?.phone || '')
    setProfPw(''); setProfPw2(''); setProfPin(''); setProfPin2('')
    setProfMsg(null)
    setTab('profile')
  }

  async function saveProfile() {
    if (!profName.trim()) return setProfMsg({ ok: false, text: 'กรุณากรอกชื่อ' })
    if (profPw && profPw !== profPw2) return setProfMsg({ ok: false, text: 'รหัสผ่านใหม่ไม่ตรงกัน' })
    if (profPin && profPin !== profPin2) return setProfMsg({ ok: false, text: 'PIN ใหม่ไม่ตรงกัน' })
    if (profPin && profPin.length < 4) return setProfMsg({ ok: false, text: 'PIN ต้องมีอย่างน้อย 4 หลัก' })
    setProfLoad(true); setProfMsg(null)
    try {
      const body = {
        employee_id: session.employee_id, password: session.password,
        name: profName, nickname: profNick, phone: profPhone,
      }
      if (profPw) body.new_password = profPw
      if (profPin) body.new_pin = profPin
      const res  = await fetch('/api/update-profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.error) return setProfMsg({ ok: false, text: json.error })
      // update local session if password changed
      if (profPw) {
        const newSess = { ...session, password: profPw }
        setSession(newSess)
        try { localStorage.setItem('staff_session', JSON.stringify(newSess)) } catch {}
      }
      setProfPw(''); setProfPw2(''); setProfPin(''); setProfPin2('')
      setProfMsg({ ok: true, text: 'บันทึกข้อมูลเรียบร้อยแล้ว' })
      await refreshData()
    } catch { setProfMsg({ ok: false, text: 'เชื่อมต่อไม่ได้' }) }
    finally { setProfLoad(false) }
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
  async function doAdvance(fixedAmt) {
    const amt = fixedAmt ?? Number(amount)
    if (!amt || !session || advLoad) return
    setAdvLoad(true); setAdvMsg(null)
    try {
      const res  = await fetch('/api/advance', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ employee_id: session.employee_id, password: session.password, amount: amt }),
      })
      const json = await res.json()
      if (json.error) { setAdvMsg({ ok:false, text: json.error }); return }
      const autoOk = json.autoApproved
      setAdvMsg({ ok:true, auto: autoOk, text: autoOk ? `อนุมัติทันที ✅ ฿${fmtMoney(json.amount)}` : `ส่งคำขอเบิก ฿${fmtMoney(json.amount)} แล้ว` })
      setAmount(''); setShowAdvForm(false)
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

  async function loadSalary(period) {
    if (!session) return
    setSalaryLoad(true)
    try {
      const res  = await fetch('/api/my-payroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: session.employee_id, password: session.password, period }),
      })
      const json = await res.json()
      if (!json.error) setSalaryData(json)
    } catch {}
    setSalaryLoad(false)
  }

  function changeSalaryMonth(delta) {
    const [y, m] = salaryPeriod.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const newPeriod = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7)
    setSalaryPeriod(newPeriod)
    setSalaryData(null)
    loadSalary(newPeriod)
  }

  function openSalaryTab() {
    setTab('salary')
    if (!salaryData || salaryData.period !== salaryPeriod) loadSalary(salaryPeriod)
  }

  function printSlip(sd) {
    if (!sd) return
    const fmtN = n => Number(n || 0).toLocaleString('th-TH')
    const name = sd.employee?.nickname || sd.employee?.name
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>สลิปค่าแรง ${name}</title>
<style>
  body{font-family:Arial,sans-serif;max-width:320px;margin:0 auto;padding:16px;font-size:13px}
  h2{text-align:center;margin:0 0 4px;font-size:16px}
  .sub{text-align:center;color:#666;margin-bottom:12px;font-size:12px}
  .row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #eee}
  .row.total{border-top:2px solid #333;border-bottom:none;font-weight:bold;font-size:14px;margin-top:4px}
  .deduct{color:#dc2626}.earn{color:#16a34a}.net{color:#2563eb;font-size:16px}
  footer{text-align:center;color:#999;font-size:10px;margin-top:16px}
</style></head><body>
<h2>สลิปค่าแรง</h2>
<div class="sub">${name} · ${sd.monthLabel}</div>
<div class="row"><span>วันทำงาน</span><span>${sd.daysWorked} วัน</span></div>
<div class="row"><span>ค่าแรง (${fmtN(sd.daily_rate)}/วัน)</span><span class="earn">฿${fmtN(sd.grossPay)}</span></div>
${sd.streakBonus > 0 ? `<div class="row"><span>โบนัส 10 วันติด</span><span class="earn">+฿${fmtN(sd.streakBonus)}</span></div>` : ''}
${(sd.bonusDetail || []).map(b => `<div class="row"><span>${b.note || 'โบนัสพิเศษ'}</span><span class="earn">+฿${fmtN(b.amount)}</span></div>`).join('')}
${sd.commission > 0 ? `<div class="row"><span>ค่าคอม</span><span class="earn">+฿${fmtN(sd.commission)}</span></div>` : ''}
<div class="row"><span>รวมรายได้</span><span class="earn">฿${fmtN(sd.totalEarned)}</span></div>
<div style="height:6px"></div>
${sd.totalWithdrawn > 0 ? `<div class="row"><span>เบิกไปแล้ว</span><span class="deduct">-฿${fmtN(sd.totalWithdrawn)}</span></div>` : ''}
${(sd.installmentDetail || []).filter(i => i.deductAmount > 0).map(i => `<div class="row"><span>${i.name} (${i.thisMonth} วัน)</span><span class="deduct">-฿${fmtN(i.deductAmount)}</span></div>`).join('')}
${sd.carryForwardIn > 0 ? `<div class="row"><span>ทบจากเดือนก่อน</span><span class="deduct">-฿${fmtN(sd.carryForwardIn)}</span></div>` : ''}
<div class="row total"><span>${sd.netPayDue >= 0 ? 'คงเหลือจ่าย' : 'ทบเดือนหน้า'}</span><span class="${sd.netPayDue >= 0 ? 'net' : 'deduct'}">${sd.netPayDue < 0 ? '−' : ''}฿${fmtN(Math.abs(sd.netPayDue))}</span></div>
<footer>พิมพ์ ${new Date().toLocaleDateString('th-TH')}</footer>
</body></html>`
    const w = window.open('', '_blank', 'width=380,height=600')
    if (w) { w.document.write(html); w.document.close(); w.print() }
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
        <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 -mx-4 px-4" style={{scrollbarWidth:'none'}}>
          {[
            { id:'home',    label:'หน้าหลัก' },
            { id:'leave',   label:`ลา${pendLeave ? ` (${pendLeave})` : ''}` },
            { id:'salary',  label:'ค่าแรง' },
            { id:'history', label:'ประวัติ' },
            { id:'profile', label:'โปรไฟล์' },
          ].map(t => (
            <button key={t.id} onClick={() => {
              if (t.id === 'profile') openProfileTab(emp)
              else if (t.id === 'salary') openSalaryTab()
              else setTab(t.id)
            }}
              className={`shrink-0 py-2 px-3 rounded-xl text-xs font-semibold transition-all ${tab===t.id ? 'bg-brand text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: หน้าหลัก */}
        {tab==='home' && (
          <div className="space-y-3">

            {/* ── ประกาศจากร้าน ── */}
            {announcements.map(ann => (
              <div key={ann.id} className={`rounded-2xl p-4 border
                ${ann.type === 'urgent'  ? 'bg-red-50 border-red-200'
                : ann.type === 'holiday' ? 'bg-amber-50 border-amber-200'
                :                          'bg-blue-50 border-blue-200'}`}>
                <div className="flex items-start gap-2">
                  <span className="text-lg leading-none mt-0.5">
                    {ann.type === 'urgent' ? '🚨' : ann.type === 'holiday' ? '📅' : '📢'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm
                      ${ann.type === 'urgent'  ? 'text-red-700'
                      : ann.type === 'holiday' ? 'text-amber-700'
                      :                          'text-blue-700'}`}>
                      {ann.title}
                    </p>
                    {ann.body && <p className="text-xs text-slate-600 mt-0.5 whitespace-pre-line">{ann.body}</p>}
                    <p className="text-[10px] text-slate-400 mt-1">
                      {new Date(ann.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' })}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {/* ── ยอดคงเหลือเดือนนี้ ── */}
            {salaryData && (
              <button onClick={() => openSalaryTab()}
                className="w-full bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between active:bg-slate-50 transition-all">
                <div className="text-left">
                  <p className="text-xs text-slate-400 font-semibold">คงเหลือจ่าย {salaryData.monthLabel}</p>
                  <p className={`text-2xl font-bold mt-0.5 ${salaryData.netPayDue >= 0 ? 'text-blue-600' : 'text-orange-500'}`}>
                    {salaryData.netPayDue < 0 ? '−' : ''}฿{fmtMoney(Math.abs(salaryData.netPayDue))}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{salaryData.daysWorked} วัน · เบิกไปแล้ว ฿{fmtMoney(salaryData.totalWithdrawn)}</p>
                </div>
                <span className="text-slate-300 text-xl">›</span>
              </button>
            )}
            {salaryLoad && !salaryData && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center text-slate-300 text-sm">⏳ โหลดยอดเดือนนี้...</div>
            )}

            {/* ── Advance section ── */}
            {session && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                {/* ปุ่มหลัก: เบิกวันนี้ + ระบุยอด */}
                <div className="flex gap-2">
                  {data?.net_daily > 0 && (
                    <button onClick={() => doAdvance(data.net_daily)} disabled={advLoad}
                      className="flex-1 bg-emerald-500 text-white rounded-2xl py-3 shadow-sm active:scale-95 transition-all disabled:opacity-50 text-center">
                      <p className="text-[10px] font-medium opacity-80">เบิกค่าแรงวันนี้</p>
                      <p className="text-xl font-bold">฿{fmtMoney(data.net_daily)}</p>
                      <p className="text-[10px] opacity-70">อนุมัติทันที ✅</p>
                    </button>
                  )}
                  <button onClick={() => { setShowAdvForm(f => !f); setAdvMsg(null) }}
                    className={`${data?.net_daily > 0 ? 'w-24' : 'flex-1'} rounded-2xl py-3 text-sm font-bold border active:scale-95 transition-all
                      ${showAdvForm ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-amber-600 border-amber-200'}`}>
                    {showAdvForm ? '✕ ปิด' : '✏️\nระบุยอด'}
                  </button>
                </div>

                {/* Numpad ระบุยอด */}
                {showAdvForm && (
                  <div className="space-y-2">
                    <div className="bg-slate-50 rounded-2xl py-3 text-center border border-slate-100">
                      <p className="text-3xl font-bold text-amber-600">
                        {amount ? `฿${fmtMoney(Number(amount))}` : <span className="text-slate-300">฿0</span>}
                      </p>
                      {data?.net_daily > 0 && Number(amount) > data.net_daily && (
                        <p className="text-xs text-orange-500 mt-1">เกินค่าแรงวันนี้ → ต้องขออนุมัติ</p>
                      )}
                    </div>
                    <Numpad onKey={pressAmount} confirmDisabled={!amount || amount==='0'} loading={advLoad} />
                  </div>
                )}

                {/* Feedback */}
                {advMsg && (
                  <p className={`text-sm font-semibold text-center ${advMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {advMsg.ok ? '' : '❌'} {advMsg.text}
                  </p>
                )}

                {/* รายการเบิกวันนี้ */}
                {(data?.advances||[]).filter(a => a.requested_at?.slice(0,10) === todayStr()).map(a => (
                  <div key={a.id} className="flex items-center justify-between py-2 border-t border-slate-100">
                    <div>
                      <p className="text-base font-bold text-amber-600">฿{fmtMoney(a.amount)}</p>
                      {a.note && <p className="text-xs text-slate-400">{a.note}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge status={a.status} />
                      {a.status==='pending' && (
                        <button onClick={() => doCancelAdvance(a.id)}
                          className="text-xs text-red-400 border border-red-200 rounded-full px-2 py-0.5 active:scale-95">
                          ยกเลิก
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ประวัติเข้างาน */}
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
            {(data?.recentAtt||[]).length===0 && !session && <p className="text-center text-slate-300 py-8 text-sm">ยังไม่มีประวัติเข้างาน</p>}
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

        {/* Tab: ค่าแรง */}
        {tab==='salary' && (
          <div className="space-y-3">
            {/* Month picker */}
            <div className="flex items-center justify-center gap-4">
              <button onClick={() => changeSalaryMonth(-1)} className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-500 text-lg active:scale-95">‹</button>
              <p className="font-bold text-slate-700 w-28 text-center">{salaryData?.monthLabel || salaryPeriod}</p>
              <button onClick={() => changeSalaryMonth(1)} className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-500 text-lg active:scale-95">›</button>
            </div>

            {salaryLoad && (
              <div className="py-10 text-center">
                <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-slate-400 text-xs">กำลังคำนวณ…</p>
              </div>
            )}

            {!salaryLoad && salaryData && (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white rounded-2xl border border-slate-100 p-3 text-center">
                    <p className="text-[10px] text-slate-400 mb-0.5">วันทำงาน</p>
                    <p className="text-2xl font-bold text-slate-800">{salaryData.daysWorked}</p>
                    <p className="text-[10px] text-slate-400">วัน</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-100 p-3 text-center">
                    <p className="text-[10px] text-slate-400 mb-0.5">รายได้รวม</p>
                    <p className="text-2xl font-bold text-emerald-600">฿{fmtMoney(salaryData.totalEarned)}</p>
                    <p className="text-[10px] text-slate-400">บาท</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-100 p-3 text-center">
                    <p className="text-[10px] text-slate-400 mb-0.5">เบิก+หัก</p>
                    <p className="text-2xl font-bold text-red-500">฿{fmtMoney(salaryData.totalWithdrawn + salaryData.installmentDeduct + salaryData.carryForwardIn)}</p>
                    <p className="text-[10px] text-slate-400">บาท</p>
                  </div>
                  <div className={`rounded-2xl border p-3 text-center ${salaryData.netPayDue >= 0 ? 'bg-blue-50 border-blue-100' : 'bg-orange-50 border-orange-100'}`}>
                    <p className="text-[10px] text-slate-400 mb-0.5">{salaryData.netPayDue >= 0 ? 'คงเหลือ' : 'ทบเดือนหน้า'}</p>
                    <p className={`text-2xl font-bold ${salaryData.netPayDue >= 0 ? 'text-blue-600' : 'text-orange-500'}`}>
                      {salaryData.netPayDue < 0 ? '−' : ''}฿{fmtMoney(Math.abs(salaryData.netPayDue))}
                    </p>
                    <p className="text-[10px] text-slate-400">บาท</p>
                  </div>
                </div>

                {/* รายละเอียด */}
                <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-2 text-sm">
                  <p className="text-xs font-bold text-slate-500 mb-2">รายละเอียด</p>
                  <div className="flex justify-between text-slate-600">
                    <span>ค่าแรง ({salaryData.daysWorked} วัน × ฿{fmtMoney(salaryData.daily_rate)})</span>
                    <span className="text-emerald-600">+฿{fmtMoney(salaryData.grossPay)}</span>
                  </div>
                  {salaryData.streakBonus > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>โบนัส 10 วันติด</span>
                      <span className="text-emerald-600">+฿{fmtMoney(salaryData.streakBonus)}</span>
                    </div>
                  )}
                  {(salaryData.bonusDetail || []).map((b, i) => (
                    <div key={i} className="flex justify-between text-slate-600">
                      <span>{b.note || 'โบนัสพิเศษ'}</span>
                      <span className="text-emerald-600">+฿{fmtMoney(b.amount)}</span>
                    </div>
                  ))}
                  {salaryData.commission > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>ค่าคอม</span>
                      <span className="text-emerald-600">+฿{fmtMoney(salaryData.commission)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-slate-700 border-t border-dashed pt-2">
                    <span>รวมรายได้</span>
                    <span className="text-emerald-700">฿{fmtMoney(salaryData.totalEarned)}</span>
                  </div>
                  {salaryData.totalWithdrawn > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>เบิกไปแล้ว ({salaryData.advances.length} ครั้ง)</span>
                      <span className="text-red-500">−฿{fmtMoney(salaryData.totalWithdrawn)}</span>
                    </div>
                  )}
                  {(salaryData.installmentDetail || []).filter(i => i.deductAmount > 0).map((inst, i) => (
                    <div key={i} className="flex justify-between text-slate-600">
                      <span>{inst.name} ({inst.thisMonth} วัน)</span>
                      <span className="text-red-500">−฿{fmtMoney(inst.deductAmount)}</span>
                    </div>
                  ))}
                  {salaryData.carryForwardIn > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>ทบจากเดือนก่อน</span>
                      <span className="text-orange-500">−฿{fmtMoney(salaryData.carryForwardIn)}</span>
                    </div>
                  )}
                  <div className={`flex justify-between font-bold border-t-2 border-slate-200 pt-2 ${salaryData.netPayDue >= 0 ? 'text-blue-700' : 'text-orange-600'}`}>
                    <span>{salaryData.netPayDue >= 0 ? 'คงเหลือต้องจ่าย' : 'ขาด → ทบเดือนหน้า'}</span>
                    <span>{salaryData.netPayDue < 0 ? '−' : ''}฿{fmtMoney(Math.abs(salaryData.netPayDue))}</span>
                  </div>
                </div>

                {/* รายการผ่อน */}
                {(salaryData.installmentDetail || []).filter(i => i.total_days > 0).length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3">
                    <p className="text-xs font-bold text-slate-500">รายการผ่อน</p>
                    {salaryData.installmentDetail.filter(i => i.total_days > 0).map((inst, i) => {
                      const pct = Math.min(100, Math.round((inst.paid_days / inst.total_days) * 100))
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-700 font-medium">{inst.name}</span>
                            <span className="text-slate-400 text-xs">{inst.paid_days}/{inst.total_days} วัน</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-2">
                            <div className="bg-violet-400 h-2 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            หักวันละ ฿{fmtMoney(inst.amount_per_day)} · เหลือ {inst.remaining - inst.thisMonth} วัน
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* ปุ่มพิมพ์สลิป */}
                <button onClick={() => printSlip(salaryData)}
                  className="w-full py-3 rounded-2xl bg-white border border-slate-200 text-slate-600 font-semibold text-sm active:scale-95 transition-all flex items-center justify-center gap-2">
                  🖨️ พิมพ์สลิปเดือน{salaryData.monthLabel}
                </button>

                {salaryData.settled && (
                  <p className="text-center text-xs text-emerald-600 font-semibold">✅ ปิดบัญชีแล้ว</p>
                )}
              </>
            )}
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

        {/* Tab: โปรไฟล์ */}
        {tab==='profile' && (
          <div className="space-y-4">
            {/* ชื่อเล่น banner */}
            <div className="rounded-2xl p-4 flex items-center gap-3"
              style={{ background: 'linear-gradient(135deg,#C72C41,#a02235)' }}>
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-white text-xl font-bold shrink-0">
                {(profNick || profName).charAt(0)}
              </div>
              <div>
                <p className="text-white font-bold text-lg leading-tight">{profNick || profName || '—'}</p>
                <p className="text-white/70 text-xs">ชื่อเล่นนี้จะแสดงใน แท็กช่างซ่อม ของ POS</p>
              </div>
            </div>

            {/* ข้อมูลส่วนตัว */}
            <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3">
              <p className="text-sm font-bold text-slate-700">ข้อมูลส่วนตัว</p>
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">ชื่อ-นามสกุล *</label>
                <input value={profName} onChange={e => setProfName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">ชื่อเล่น <span className="text-violet-500">(ใช้แท็กช่างซ่อมใน POS)</span></label>
                <input value={profNick} onChange={e => setProfNick(e.target.value)}
                  placeholder="เช่น เอิน, ศรี"
                  className="w-full border border-violet-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">เบอร์โทรศัพท์</label>
                <input value={profPhone} onChange={e => setProfPhone(e.target.value)}
                  type="tel" inputMode="tel"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand" />
              </div>
            </div>

            {/* เปลี่ยนรหัสผ่าน */}
            <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3">
              <p className="text-sm font-bold text-slate-700">เปลี่ยนรหัสผ่าน <span className="text-xs font-normal text-slate-400">(เว้นว่างถ้าไม่เปลี่ยน)</span></p>
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">รหัสผ่านใหม่</label>
                <input value={profPw} onChange={e => setProfPw(e.target.value)}
                  type="password" placeholder="รหัสผ่านใหม่"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand" />
              </div>
              {profPw && (
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">ยืนยันรหัสผ่านใหม่</label>
                  <input value={profPw2} onChange={e => setProfPw2(e.target.value)}
                    type="password" placeholder="พิมอีกครั้ง"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand" />
                </div>
              )}
            </div>

            {/* เปลี่ยน PIN */}
            <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3">
              <p className="text-sm font-bold text-slate-700">เปลี่ยน PIN <span className="text-xs font-normal text-slate-400">(เว้นว่างถ้าไม่เปลี่ยน)</span></p>
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">PIN ใหม่ (4-6 หลัก)</label>
                <input value={profPin} onChange={e => setProfPin(e.target.value.replace(/\D/g,'').slice(0,6))}
                  type="password" inputMode="numeric" placeholder="••••"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand tracking-widest" />
              </div>
              {profPin && (
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">ยืนยัน PIN ใหม่</label>
                  <input value={profPin2} onChange={e => setProfPin2(e.target.value.replace(/\D/g,'').slice(0,6))}
                    type="password" inputMode="numeric" placeholder="••••"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand tracking-widest" />
                </div>
              )}
            </div>

            {profMsg && (
              <p className={`text-sm font-semibold text-center py-2 ${profMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
                {profMsg.ok ? '✅' : '❌'} {profMsg.text}
              </p>
            )}
            <button onClick={saveProfile} disabled={profLoad}
              className="w-full py-3.5 rounded-2xl bg-brand text-white font-bold text-sm shadow active:scale-95 transition-all disabled:opacity-40">
              {profLoad ? 'กำลังบันทึก…' : '💾 บันทึกข้อมูล'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
