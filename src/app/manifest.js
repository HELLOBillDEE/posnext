export default async function manifest() {
  // ดึงโลโก้และชื่อร้านจาก Supabase
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
    name: 'ช่างเชิด',
    short_name: 'ช่างเชิด',
    description: 'ระบบ POS ร้านช่างเชิด',
    start_url: '/pos',
    display: 'standalone',
    background_color: '#f8f0f2',
    theme_color: '#C72C41',
    orientation: 'portrait',
    icons: [
      { src: '/cherd-icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any maskable' },
      { src: '/cherd-icon.png', sizes: '512x512',   type: 'image/png' },
      { src: '/cherd-icon.png', sizes: '192x192',   type: 'image/png' },
    ],
  }
}
