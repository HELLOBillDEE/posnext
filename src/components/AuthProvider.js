'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

const COOKIE_OPTS = 'path=/; SameSite=Strict; max-age=315360000' // 10 ปี (ถาวร)
function setAuthCookie(token) { document.cookie = `pos_token=${token}; ${COOKIE_OPTS}` }
function clearAuthCookie() { document.cookie = `pos_token=; path=/; SameSite=Strict; max-age=0` }
function setEmpCookie() { document.cookie = `pos_emp=1; ${COOKIE_OPTS}` }
function clearEmpCookie() { document.cookie = `pos_emp=; path=/; SameSite=Strict; max-age=0` }

// Routes employees can access
const EMP_ROUTES = ['/pos', '/products', '/documents', '/repair', '/customers', '/po']

function getStoredUser() {
  try {
    // Supabase JS v2 stores session under "sb-<ref>-auth-token"
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const s = JSON.parse(localStorage.getItem(k))
        if (s?.user) return s.user
      }
    }
  } catch {}
  return undefined
}

export default function AuthProvider({ children }) {
  const [user, setUser]         = useState(undefined)
  const [empMode, setEmpMode]   = useState(null) // { id, name, position } or null
  const router  = useRouter()
  const path    = usePathname()

  // Load Supabase auth
  useEffect(() => {
    // อ่าน session จาก localStorage ทันที (ไม่รอ network)
    const cached = getStoredUser()
    if (cached !== undefined) setUser(cached)

    const timeout = setTimeout(() => setUser(u => u === undefined ? null : u), 5000)

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        clearTimeout(timeout)
        setUser(session?.user ?? null)
        if (session?.access_token) setAuthCookie(session.access_token)
      })
      .catch(() => { clearTimeout(timeout); setUser(null) })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
      if (session?.access_token) setAuthCookie(session.access_token)
      else clearAuthCookie()
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load employee session from localStorage and sync cookie
  useEffect(() => {
    try {
      const saved = localStorage.getItem('emp_session')
      if (saved) {
        setEmpMode(JSON.parse(saved))
        setEmpCookie()
      } else {
        clearEmpCookie()
      }
    } catch {}
  }, [])

  // Routing guard
  useEffect(() => {
    if (user === undefined) return
    const publicPaths = ['/login', '/checkin', '/staff', '/leave', '/advance', '/my']
    if (!user && !publicPaths.some(p => path === p || path.startsWith(p + '/'))) { router.replace('/login'); return }
    if (user && path === '/login') { router.replace('/pos'); return }

    // Employee route restriction
    if (empMode && user) {
      const allowed = EMP_ROUTES.some(r => path === r || path.startsWith(r + '/'))
      if (!allowed && path !== '/login') router.replace('/pos')
    }
  }, [user, empMode, path])

  async function logout() {
    setEmpMode(null)
    try { localStorage.removeItem('emp_session') } catch {}
    clearEmpCookie()
    clearAuthCookie()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  function empLogin(emp) {
    const session = { id: emp.id, name: emp.name, position: emp.position || '' }
    setEmpMode(session)
    try { localStorage.setItem('emp_session', JSON.stringify(session)) } catch {}
    setEmpCookie()
    router.replace('/pos')
  }

  function empLogout() {
    setEmpMode(null)
    try { localStorage.removeItem('emp_session') } catch {}
    clearEmpCookie()
  }

  const role = empMode ? 'employee' : 'admin'

  if (user === undefined) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">กำลังโหลด...</p>
        </div>
      </div>
    )
  }

  return (
    <AuthCtx.Provider value={{ user, empMode, role, logout, empLogin, empLogout }}>
      {children}
    </AuthCtx.Provider>
  )
}
