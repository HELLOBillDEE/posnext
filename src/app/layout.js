import './globals.css'
import Nav from '@/components/Nav'
import AuthProvider from '@/components/AuthProvider'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'POS ระบบจัดการร้านค้า',
  description: 'ระบบ POS สำหรับร้านค้า',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
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
