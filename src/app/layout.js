import './globals.css'
import { Kanit } from 'next/font/google'
import LayoutNav from '@/components/LayoutNav'
import AuthProvider from '@/components/AuthProvider'
import StaffGuard from '@/components/StaffGuard'

const kanit = Kanit({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-kanit',
  display: 'swap',
  preload: true,
})

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  let shopLogo = null
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/settings?key=eq.shop_logo&select=value`
    const res = await fetch(url, {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        'Accept-Profile': 'pos',
      },
      cache: 'no-store',
    })
    const data = await res.json()
    shopLogo = data?.[0]?.value || null
  } catch {}

  return {
    title: 'ช่างเชิด',
    description: 'ระบบ POS ร้านช่างเชิด',
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      title: 'ช่างเชิด',
      statusBarStyle: 'black-translucent',
    },
    icons: {
      apple: [{ url: '/cherd-icon.png', sizes: '1024x1024', type: 'image/png' }],
      icon:  [{ url: '/cherd-icon.png', sizes: '1024x1024', type: 'image/png' }],
    },
  }
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#C72C41',
}

export default function RootLayout({ children }) {
  return (
    <html lang="th" className={kanit.variable}>
      <body className="bg-slate-50 min-h-screen" style={{ fontFamily: 'var(--font-kanit), sans-serif' }}>
        <AuthProvider>
          <StaffGuard />
          <div className="flex min-h-screen">
            <LayoutNav />
            <main className="nav-main min-h-screen pb-[72px] md:pb-0 overflow-x-hidden" style={{ width: 'calc(100vw - var(--nav-w))' }}>
              {children}
            </main>
          </div>
        </AuthProvider>
      </body>
    </html>
  )
}
