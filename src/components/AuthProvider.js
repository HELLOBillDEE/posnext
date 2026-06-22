'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

// Routes employees can access
const EMP_ROUTES = ['/pos', '/products', '/documents']

export default function AuthProvider({ children }) {
  const [user, setUser]         = useState(undefined)
  const [empMode, setEmpMode]   = useState(null) // { id, name, position } or null
  const router  = useRouter()
  const path    = usePathname()

  // Load Supabase auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load employee session from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('emp_session')
      if (saved) setEmpMode(JSON.parse(saved))
    } catch {}
  }, [])

  // Routing guard
  useEffect(() => {
    if (user === undefined) return
    if (!user && path !== '/login') { router.replace('/login'); return }
    if (user && path === '/login') { router.replace('/'); return }

    // Employee route restriction
    if (empMode && user) {
      const allowed = EMP_ROUTES.some(r => path === r || path.startsWith(r + '/'))
      if (!allowed && path !== '/login') router.replace('/pos')
    }
  }, [user, empMode, path])

  async function logout() {
    setEmpMode(null)
    try { localStorage.removeItem('emp_session') } catch {}
    await supabase.auth.signOut()
    router.replace('/login')
  }

  function empLogin(emp) {
    const session = { id: emp.id, name: emp.name, position: emp.position || '' }
    setEmpMode(session)
    try { localStorage.setItem('emp_session', JSON.stringify(session)) } catch {}
    router.replace('/pos')
  }

  function empLogout() {
    setEmpMode(null)
    try { localStorage.removeItem('emp_session') } catch {}
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
