import { NextResponse } from 'next/server'

// Routes employees are allowed to access
const EMP_ALLOWED = ['/pos', '/documents']

// Routes that require admin (not accessible in employee mode)
const ADMIN_ONLY = ['/admin', '/employees', '/reports', '/expenses', '/shifts', '/po']

export function middleware(request) {
  const { pathname } = request.nextUrl
  const isEmp = request.cookies.get('pos_emp')?.value === '1'

  if (isEmp) {
    const isAdminRoute = ADMIN_ONLY.some(r => pathname === r || pathname.startsWith(r + '/'))
    if (isAdminRoute) {
      return NextResponse.redirect(new URL('/pos', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-192.png|api/).*)',
  ],
}
