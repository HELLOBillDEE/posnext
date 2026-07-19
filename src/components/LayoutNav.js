'use client'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import Nav from '@/components/Nav'

const NO_NAV = ['/login', '/display', '/checkin']

export default function LayoutNav() {
  const path = usePathname()
  const hide = NO_NAV.some(p => path === p || path.startsWith(p + '/'))

  useEffect(() => {
    document.documentElement.style.setProperty('--nav-w', hide ? '0px' : '')
  }, [hide])

  if (hide) return null
  return <Nav />
}
