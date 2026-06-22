import './globals.css'
import Nav from '@/components/Nav'
import AuthProvider from '@/components/AuthProvider'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  let shopLogo = null
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/settings?key=eq.shop_logo&select=value`
    const res = await fetch(url, {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
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
    icons: shopLogo ? {
      apple: [{ url: shopLogo, sizes: '180x180', type: 'image/png' }],
      icon:  [{ url: shopLogo, sizes: '192x192', type: 'image/png' }],
    } : {},
  }
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#3B5BDB',
}

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body className="bg-slate-50 min-h-screen">
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
