import './globals.css'
import { Kanit } from 'next/font/google'
import Nav from '@/components/Nav'
import AuthProvider from '@/components/AuthProvider'

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
  maximumScale: 1,
  userScalable: false,
  themeColor: '#C72C41',
}

export default function RootLayout({ children }) {
  return (
    <html lang="th" className={kanit.variable}>
      <body className="bg-slate-50 min-h-screen" style={{ fontFamily: 'var(--font-kanit), sans-serif' }}>
        <AuthProvider>
          <div className="flex min-h-screen">
            <Nav />
            <main className="flex-1 md:ml-[220px] min-h-screen pb-[72px] md:pb-0">
              {children}
            </main>
          </div>
        </AuthProvider>
      </body>
    </html>
  )
}
