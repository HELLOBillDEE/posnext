'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined)
  const router = useRouter()
  const path = usePathname()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user === undefined) return
    if (user === null && path !== '/login') router.replace('/login')
    if (user !== null && path === '/login') router.replace('/')
  }, [user, path])

  async function logout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  if (user === undefined) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-slate-400 text-sm">กำลังโหลด...</p>
        </div>
      </div>
    )
  }

  return (
    <AuthCtx.Provider value={{ user, logout }}>
      {children}
    </AuthCtx.Provider>
  )
}
