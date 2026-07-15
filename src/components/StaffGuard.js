'use client'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export default function StaffGuard() {
  const pathname = usePathname()
  const router   = useRouter()

  useEffect(() => {
    try {
      const session = localStorage.getItem('staff_session')
      if (session && pathname !== '/staff') {
        router.replace('/staff')
      }
    } catch {}
  }, [pathname])

  return null
}
