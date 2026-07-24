'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Nav from '@/components/Nav'

const NO_NAV = ['/login', '/display', '/checkin', '/emp', '/staff']

export default function LayoutNav() {
  const path = usePathname()
  const [embed, setEmbed] = useState(false)

  useEffect(() => {
    setEmbed(new URLSearchParams(window.location.search).get('embed') === '1')
  }, [])

  const hide = embed || NO_NAV.some(p => path === p || path.startsWith(p + '/'))

  useEffect(() => {
    document.documentElement.style.setProperty('--nav-w', hide ? '0px' : '')
  }, [hide])

  if (hide) return null
  return <Nav />
}
