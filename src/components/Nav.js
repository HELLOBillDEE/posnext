'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { queueCount, processQueue } from '@/lib/offlineQueue'

/* ── SVG Icon set ── */
const IC = {
  home: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  ),
  pos: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/>
    </svg>
  ),
  product: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.82-1h12l.93 1H5.12z"/>
    </svg>
  ),
  po: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M18 17H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V7h12v2zM3 22l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20z"/>
    </svg>
  ),
  report: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z"/>
    </svg>
  ),
  employees: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>
  ),
  expense: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>
    </svg>
  ),
  shift: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
    </svg>
  ),
  customer: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>
  ),
  repair: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M22.61 18.99l-9.08-9.08c.93-2.34.45-5.1-1.44-7C9.79.61 7.21.45 5.45 1.67L8.28 4.5 4.51 8.28 1.68 5.45C.45 7.21.62 9.8 2.92 12.09c1.86 1.86 4.58 2.35 6.89 1.48l9.11 9.11c.39.39 1.02.39 1.41 0l2.27-2.27c.4-.38.4-1.02.01-1.42z"/>
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
    </svg>
  ),
}

const ALL_TABS = [
  { href:'/',          label:'หน้าหลัก',  icon: IC.home,      adminOnly: true },
  { href:'/pos',       label:'ขาย',       icon: IC.pos },
  { href:'/products',  label:'สินค้า',    icon: IC.product },
  { href:'/po',        label:'สั่งซื้อ',  icon: IC.po },
  { href:'/repair',    label:'คิวซ่อม',   icon: IC.repair },
  { href:'/customers', label:'ลูกค้า',    icon: IC.customer },
  { href:'/documents', label:'เอกสาร',    icon: IC.doc },
  { href:'/reports',   label:'รายงาน',    icon: IC.report,    adminOnly: true },
  { href:'/employees', label:'พนักงาน',   icon: IC.employees, adminOnly: true },
  { href:'/expenses',  label:'ค่าใช้จ่าย', icon: IC.expense,  adminOnly: true },
  { href:'/shifts',    label:'กะ',         icon: IC.shift,    adminOnly: true },
  { href:'/admin',     label:'ตั้งค่า',   icon: IC.settings,  adminOnly: true },
]

export default function Nav() {
  const path = usePathname()
  const auth = useAuth()
  const [isOnline, setIsOnline]           = useState(true)
  const [pendingCount, setPendingCount]   = useState(0)
  const [syncing, setSyncing]             = useState(false)

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine)
    const updateCount = () => setPendingCount(queueCount())
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    window.addEventListener('offline-queue-changed', updateCount)
    update(); updateCount()
    // auto-sync when back online
    const handleOnline = async () => {
      update()
      const count = queueCount()
      if (count === 0) return
      setSyncing(true)
      await processQueue(supabase)
      setPendingCount(queueCount())
      setSyncing(false)
      window.dispatchEvent(new Event('offline-synced'))
    }
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      window.removeEventListener('offline-queue-changed', updateCount)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  const [showEmpPicker, setShowEmpPicker] = useState(false)
  const [employees, setEmployees]         = useState([])
  const [selEmp, setSelEmp]               = useState(null)
  const [pin, setPin]                     = useState('')
  const [pinError, setPinError]           = useState('')

  const [showAdminPin, setShowAdminPin]     = useState(false)
  const [adminPin, setAdminPin]             = useState('')
  const [adminPinError, setAdminPinError]   = useState('')
  const [storedAdminPin, setStoredAdminPin] = useState(null)

  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('nav_collapsed') === '1'
      setCollapsed(saved)
      document.documentElement.style.setProperty('--nav-w', saved ? '62px' : '230px')
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem('nav_collapsed', collapsed ? '1' : '0') } catch {}
    document.documentElement.style.setProperty('--nav-w', collapsed ? '62px' : '230px')
  }, [collapsed])

  if (path === '/login' || !auth?.user) return null

  const isAdmin = auth.role === 'admin'
  const TABS = ALL_TABS.filter(t => isAdmin || !t.adminOnly)
  const isActive = (href) => href === '/' ? path === '/' : path === href || path.startsWith(href + '/')

  async function openEmpPicker() {
    const { data } = await supabase.from('employees')
      .select('id,name,position,pin').eq('active', true).order('name')
    setEmployees(data || [])
    setSelEmp(null)
    setPin('')
    setPinError('')
    setShowEmpPicker(true)
  }

  async function openAdminPin() {
    const { data } = await supabase.from('settings').select('value').eq('key', 'admin_pin').single()
    setStoredAdminPin(data?.value || null)
    setAdminPin('')
    setAdminPinError('')
    setShowAdminPin(true)
  }

  function handleAdminPinDigit(d) {
    if (adminPin.length >= 4) return
    const next = adminPin + d
    setAdminPin(next)
    if (next.length === 4) {
      if (!storedAdminPin || next === storedAdminPin) {
        auth.empLogout()
        setShowAdminPin(false)
      } else {
        setAdminPinError('PIN ไม่ถูกต้อง')
        setAdminPin('')
      }
    }
  }

  function handlePinDigit(d) {
    if (pin.length >= 4) return
    const next = pin + d
    setPin(next)
    if (next.length === 4) verifyPin(next)
  }

  function verifyPin(p) {
    if (!selEmp) return
    if (!selEmp.pin) { auth.empLogin(selEmp); setShowEmpPicker(false); return }
    if (p === selEmp.pin) { auth.empLogin(selEmp); setShowEmpPicker(false) }
    else { setPinError('PIN ไม่ถูกต้อง'); setPin('') }
  }

  return (
    <>
      {/* ── Sidebar (md+) ── */}
      <aside className="hidden md:flex fixed left-0 top-0 bottom-0 flex-col z-50 no-print overflow-hidden"
        style={{
          width: collapsed ? '62px' : '230px',
          transition: 'width 0.25s ease',
          background: 'linear-gradient(180deg, #14060a 0%, #2D142C 100%)',
        }}>

        {/* Subtle border right */}
        <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-white/0 via-white/10 to-white/0" />

        {/* Logo — click to toggle */}
        <button onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-3 px-4 py-5 w-full text-left hover:bg-white/5 transition-colors flex-shrink-0"
          title={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}>
          <img src="/logo.png" alt="CHERD" className="w-10 h-10 rounded-2xl shadow-lg flex-shrink-0 object-cover" />
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[11px] text-white/40 whitespace-nowrap">จัดการร้านค้า</p>
              {!isOnline ? (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{background:'rgba(239,68,68,0.2)',color:'#f87171'}}>
                  ● ออฟไลน์{pendingCount > 0 ? ` · ${pendingCount} รอ sync` : ''}
                </span>
              ) : syncing ? (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{background:'rgba(245,158,11,0.2)',color:'#fbbf24'}}>
                  ⟳ sync…
                </span>
              ) : pendingCount > 0 ? (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{background:'rgba(245,158,11,0.2)',color:'#fbbf24'}}>
                  ● {pendingCount} รอ sync
                </span>
              ) : null}
            </div>
          )}
        </button>

        {/* Divider */}
        <div className="mx-3 h-px bg-white/8 mb-2" />

        {/* Links */}
        <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto scroll-hidden">
          {TABS.map(t => {
            const active = isActive(t.href)
            return (
              <Link key={t.href} href={t.href} title={collapsed ? t.label : undefined}
                className={`flex items-center rounded-xl text-sm font-medium transition-all group
                  ${collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2.5'}
                  ${active ? 'text-white' : 'text-white/45 hover:text-white/80'}`}
                style={active ? {
                  background: 'rgba(199,44,65,0.25)',
                  border: '1px solid rgba(199,44,65,0.3)',
                } : {}}>

                <div className={`icon-glass flex-shrink-0 ${active ? 'icon-glass-active' : 'icon-glass-inactive'}`}>
                  <span className={active ? 'text-white' : 'text-brand-light'}>
                    {t.icon}
                  </span>
                </div>

                {!collapsed && <span className="flex-1 whitespace-nowrap">{t.label}</span>}
                {!collapsed && active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-light/80 flex-shrink-0" />
                )}
              </Link>
            )
          })}
        </nav>

        {/* User & Logout */}
        <div className="px-2 pb-5 pt-3">
          <div className="h-px bg-white/8 mb-3" />

          {/* User chip */}
          {collapsed ? (
            <div className="flex justify-center mb-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                title={auth.empMode ? auth.empMode.name : auth.user?.email}
                style={{ background: auth.empMode ? 'linear-gradient(135deg,#059669,#34d399)' : 'linear-gradient(135deg,#C72C41,#EE4540)' }}>
                {auth.empMode ? auth.empMode.name[0] : (auth.user?.email?.[0]?.toUpperCase() ?? 'U')}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-1"
              style={{ background: auth.empMode ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.05)', border: auth.empMode ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 text-white"
                style={{ background: auth.empMode ? 'linear-gradient(135deg,#059669,#34d399)' : 'linear-gradient(135deg,#C72C41,#EE4540)' }}>
                {auth.empMode ? auth.empMode.name[0] : (auth.user?.email?.[0]?.toUpperCase() ?? 'U')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-white/70 truncate font-semibold">
                  {auth.empMode ? auth.empMode.name : auth.user?.email}
                </p>
                {auth.empMode && <p className="text-[9px] text-emerald-400">{auth.empMode.position}</p>}
              </div>
            </div>
          )}

          {/* Switch / Logout */}
          {auth.empMode ? (
            <>
              <button onClick={openEmpPicker} title="สลับพนักงาน"
                className={`w-full flex items-center rounded-xl text-sm text-white/40 transition-all group mb-1
                  ${collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2'}`}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(199,44,65,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div className="icon-glass icon-glass-inactive w-8 h-8 rounded-lg flex-shrink-0">
                  <span className="text-brand-light text-sm">🔄</span>
                </div>
                {!collapsed && <span className="group-hover:text-brand-light transition-colors text-xs whitespace-nowrap">สลับพนักงาน</span>}
              </button>
              <button onClick={openAdminPin} title="โหมดแอดมิน"
                className={`w-full flex items-center rounded-xl text-sm text-white/40 transition-all group
                  ${collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2'}`}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div className="icon-glass icon-glass-inactive w-8 h-8 rounded-lg flex-shrink-0">
                  <span className="text-red-400 text-sm">🔐</span>
                </div>
                {!collapsed && <span className="group-hover:text-red-400 transition-colors text-xs whitespace-nowrap">โหมดแอดมิน</span>}
              </button>
            </>
          ) : (
            <>
              <button onClick={openEmpPicker} title="โหมดพนักงาน"
                className={`w-full flex items-center rounded-xl text-sm text-white/40 transition-all group mb-1
                  ${collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2'}`}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(199,44,65,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div className="icon-glass icon-glass-inactive w-8 h-8 rounded-lg flex-shrink-0">
                  <span className="text-brand-light text-sm">👷</span>
                </div>
                {!collapsed && <span className="group-hover:text-brand-light transition-colors text-xs whitespace-nowrap">โหมดพนักงาน</span>}
              </button>
              <button onClick={auth.logout} title="ออกจากระบบ"
                className={`w-full flex items-center rounded-xl text-sm text-white/40 transition-all group
                  ${collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2.5'}`}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div className="icon-glass icon-glass-inactive group-hover:border-red-500/30 w-8 h-8 rounded-lg flex-shrink-0">
                  <span className="text-white/40 group-hover:text-red-400 transition-colors">{IC.logout}</span>
                </div>
                {!collapsed && <span className="group-hover:text-red-400 transition-colors whitespace-nowrap">ออกจากระบบ</span>}
              </button>
            </>
          )}
        </div>
      </aside>

      {/* ── Bottom tab bar (mobile) ── */}
      <nav className="fixed bottom-0 left-0 right-0 md:hidden z-50 no-print"
        style={{
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(140,0,0,0.1)',
          boxShadow: '0 -8px 32px rgba(140,0,0,0.08)',
        }}>

        <div className="flex overflow-x-auto scroll-hidden px-1 pt-2 pb-safe"
          style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>

          {/* CHERD icon */}
          <div className="flex flex-col items-center justify-center py-1 px-2 flex-shrink-0">
            <img src="/logo.png" alt="CHERD" className="w-9 h-9 rounded-[11px] object-cover shadow-sm" />
            <span className="text-[9px] leading-tight font-semibold text-slate-300 mt-1">CHERD</span>
          </div>

          {TABS.map(t => {
            const active = isActive(t.href)
            return (
              <Link key={t.href} href={t.href}
                className="flex flex-col items-center justify-center py-1 px-1 flex-1 min-w-[52px] transition-all">
                <div className={`icon-glass mb-1 w-9 h-9 rounded-[11px] transition-all ${
                  active ? 'icon-glass-active scale-105' : 'icon-glass-inactive'
                }`}>
                  <span className={active ? 'text-white' : 'text-brand-light'}>
                    {t.icon}
                  </span>
                </div>
                <span className={`text-[9px] leading-tight font-semibold ${
                  active ? 'text-brand' : 'text-slate-400'
                }`}>
                  {t.label}
                </span>
              </Link>
            )
          })}

          {/* Account switcher */}
          <button
            onClick={openEmpPicker}
            className="flex flex-col items-center justify-center py-1 px-2 flex-shrink-0 gap-1">
            <div className="w-9 h-9 rounded-[11px] flex items-center justify-center font-bold text-white text-sm shadow-sm"
              style={{ background: auth.empMode ? 'linear-gradient(135deg,#059669,#34d399)' : 'linear-gradient(135deg,#C72C41,#EE4540)' }}>
              {auth.empMode ? auth.empMode.name[0] : (auth.user?.email?.[0]?.toUpperCase() ?? 'A')}
            </div>
            <span className="text-[9px] leading-tight font-semibold text-slate-400">
              {auth.empMode ? 'สลับ' : 'พนักงาน'}
            </span>
          </button>
        </div>
      </nav>

      {/* ── Admin PIN Modal ── */}
      {showAdminPin && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAdminPin(false) }}>
          <div className="w-full max-w-xs rounded-3xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg,#14060a,#2D142C)', border: '1px solid rgba(255,255,255,0.15)' }}>
            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
              <p className="font-bold text-white text-base">🔐 เข้าโหมดแอดมิน</p>
              <button onClick={() => setShowAdminPin(false)} className="text-white/40 hover:text-white text-xl leading-none">✕</button>
            </div>
            <div className="px-5 pb-6">
              <div className="flex justify-center gap-4 mb-2 mt-2">
                {[0,1,2,3].map(i => (
                  <div key={i} className={`w-4 h-4 rounded-full transition-all ${i < adminPin.length ? 'bg-red-400 scale-110' : 'bg-white/20'}`} />
                ))}
              </div>
              <p className="text-center text-white/40 text-xs mb-3">
                {storedAdminPin ? 'กรอก PIN แอดมิน 4 หลัก' : 'ยังไม่มี PIN — กด ✓ เพื่อเข้าได้เลย'}
              </p>
              {adminPinError && <p className="text-center text-red-400 text-xs mb-2">{adminPinError}</p>}
              <div className="grid grid-cols-3 gap-2">
                {[1,2,3,4,5,6,7,8,9].map(d => (
                  <button key={d} onClick={() => handleAdminPinDigit(String(d))}
                    className="py-3 rounded-2xl text-xl font-bold text-white active:scale-95 transition-all"
                    style={{ background: 'rgba(255,255,255,0.1)' }}>
                    {d}
                  </button>
                ))}
                <button onClick={() => { if (!storedAdminPin) { auth.empLogout(); setShowAdminPin(false) } }}
                  className="py-3 rounded-2xl active:scale-95 transition-all"
                  style={{ background: !storedAdminPin ? 'rgba(239,68,68,0.25)' : 'transparent' }}>
                  {!storedAdminPin ? <span className="text-red-400 font-bold text-xl">✓</span> : ''}
                </button>
                <button onClick={() => handleAdminPinDigit('0')}
                  className="py-3 rounded-2xl text-xl font-bold text-white active:scale-95 transition-all"
                  style={{ background: 'rgba(255,255,255,0.1)' }}>
                  0
                </button>
                <button onClick={() => { setAdminPin(p => p.slice(0,-1)); setAdminPinError('') }}
                  className="py-3 rounded-2xl text-white/50 active:scale-95 transition-all text-lg"
                  style={{ background: 'rgba(255,255,255,0.05)' }}>
                  ⌫
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Employee Picker Modal ── */}
      {showEmpPicker && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowEmpPicker(false) }}>
          <div className="w-full max-w-xs rounded-3xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg,#14060a,#2D142C)', border: '1px solid rgba(255,255,255,0.15)' }}>

            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
              <p className="font-bold text-white text-base">
                {selEmp ? selEmp.name : '👷 เลือกพนักงาน'}
              </p>
              <button onClick={() => { if (selEmp) { setSelEmp(null); setPin('') } else setShowEmpPicker(false) }}
                className="text-white/40 hover:text-white text-xl leading-none">
                {selEmp ? '←' : '✕'}
              </button>
            </div>

            {!selEmp ? (
              <div className="px-4 pb-5 space-y-2 max-h-72 overflow-y-auto">
                {employees.length === 0
                  ? <p className="text-center text-white/40 text-sm py-6">ยังไม่มีพนักงาน<br/><span className="text-xs">ไปหน้าพนักงานเพื่อเพิ่มและตั้ง PIN</span></p>
                  : employees.map(emp => (
                    <button key={emp.id} onClick={() => { setSelEmp(emp); setPin(''); setPinError('') }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all active:scale-[0.98]"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shrink-0"
                        style={{ background: 'linear-gradient(135deg,#059669,#34d399)' }}>
                        {emp.name[0]}
                      </div>
                      <div>
                        <p className="font-semibold text-white text-sm">{emp.name}</p>
                        <p className="text-white/40 text-xs">{emp.position}</p>
                      </div>
                      <span className="ml-auto text-white/30">→</span>
                    </button>
                  ))
                }
                {auth.empMode && (
                  <button onClick={() => { setShowEmpPicker(false); openAdminPin() }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all active:scale-[0.98] mt-1"
                    style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shrink-0"
                      style={{ background: 'linear-gradient(135deg,#C72C41,#EE4540)' }}>
                      🔐
                    </div>
                    <div>
                      <p className="font-semibold text-white text-sm">โหมดแอดมิน</p>
                      <p className="text-white/40 text-xs">ต้องใส่ PIN แอดมิน</p>
                    </div>
                    <span className="ml-auto text-white/30">→</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="px-5 pb-6">
                <div className="flex justify-center gap-4 mb-2 mt-2">
                  {[0,1,2,3].map(i => (
                    <div key={i} className={`w-4 h-4 rounded-full transition-all ${i < pin.length ? 'bg-emerald-400 scale-110' : 'bg-white/20'}`} />
                  ))}
                </div>
                <p className="text-center text-white/40 text-xs mb-3">
                  {!selEmp.pin ? 'ยังไม่มี PIN — กด ✓ เพื่อเข้าใช้งาน' : 'กรอก PIN 4 หลัก'}
                </p>
                {pinError && <p className="text-center text-red-400 text-xs mb-2">{pinError}</p>}
                <div className="grid grid-cols-3 gap-2">
                  {[1,2,3,4,5,6,7,8,9].map(d => (
                    <button key={d} onClick={() => handlePinDigit(String(d))}
                      className="py-3 rounded-2xl text-xl font-bold text-white active:scale-95 transition-all"
                      style={{ background: 'rgba(255,255,255,0.1)' }}>
                      {d}
                    </button>
                  ))}
                  <button onClick={() => { if (!selEmp.pin) { auth.empLogin(selEmp); setShowEmpPicker(false) } }}
                    className="py-3 rounded-2xl active:scale-95 transition-all"
                    style={{ background: !selEmp.pin ? 'rgba(16,185,129,0.25)' : 'transparent' }}>
                    {!selEmp.pin ? <span className="text-emerald-400 font-bold text-xl">✓</span> : ''}
                  </button>
                  <button onClick={() => handlePinDigit('0')}
                    className="py-3 rounded-2xl text-xl font-bold text-white active:scale-95 transition-all"
                    style={{ background: 'rgba(255,255,255,0.1)' }}>
                    0
                  </button>
                  <button onClick={() => { setPin(p => p.slice(0,-1)); setPinError('') }}
                    className="py-3 rounded-2xl text-white/50 active:scale-95 transition-all text-lg"
                    style={{ background: 'rgba(255,255,255,0.05)' }}>
                    ⌫
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
