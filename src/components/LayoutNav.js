'use client'
import { usePathname } from 'next/navigation'
import Nav from '@/components/Nav'

export default function LayoutNav() {
  const path = usePathname()
  if (path === '/login' || path === '/display' || path === '/checkin') return null
  return <Nav />
}
