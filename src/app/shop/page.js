'use client'
import { useEffect, useState } from 'react'

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function ShopPage() {
  const [products, setProducts] = useState([])
  const [shop, setShop]         = useState({})
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)
  const [qrOpen, setQrOpen]     = useState(false)

  useEffect(() => {
    fetch('/api/shop').then(r => r.json()).then(d => {
      setProducts(d.products || [])
      setShop(d.shop || {})
      setLoading(false)
    })
  }, [])

  const filtered = products.filter(p => {
    const q = search.toLowerCase()
    return !q || p.name.toLowerCase().includes(q) || (p.search_tags||'').toLowerCase().includes(q)
  })

  return (
    <div className="min-h-screen" style={{ fontFamily: 'system-ui,sans-serif', background: '#f8fafc' }}>
      {/* Header */}
      <div className="sticky top-0 z-20" style={{ background: '#C72C41' }}>
        <div className="max-w-2xl mx-auto px-4 pt-10 pb-4">
          <div className="flex items-center gap-3 mb-3">
            {shop.shop_logo && (
              <img src={shop.shop_logo} alt="logo" className="w-12 h-12 rounded-full object-cover border-2 border-white/40" />
            )}
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">{shop.shop_name || 'ร้านค้า'}</h1>
              {shop.shop_phone && <p className="text-white/70 text-xs">📞 {shop.shop_phone}</p>}
            </div>
            <button
              onClick={() => setQrOpen(true)}
              className="ml-auto flex items-center gap-1.5 bg-white/20 text-white text-xs font-semibold px-3 py-2 rounded-xl"
            >
              💬 ติดต่อ LINE
            </button>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 ค้นหาสินค้า..."
            className="w-full bg-white/20 text-white placeholder-white/60 rounded-xl px-4 py-2.5 text-sm outline-none"
          />
        </div>
      </div>

      {/* Product grid */}
      <div className="max-w-2xl mx-auto px-3 py-4">
        {loading ? (
          <p className="text-center text-slate-400 py-16 text-sm">กำลังโหลดสินค้า...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-slate-400 py-16 text-sm">{search ? 'ไม่พบสินค้าที่ค้นหา' : 'ยังไม่มีสินค้า'}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map(p => (
              <div key={p.id} className="bg-white rounded-2xl overflow-hidden shadow-sm">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-full aspect-square object-cover" />
                ) : (
                  <div className="w-full aspect-square bg-slate-100 flex items-center justify-center text-4xl">📦</div>
                )}
                <div className="p-3">
                  <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">{p.name}</p>
                  <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                    <p className="text-lg font-bold" style={{ color: '#C72C41' }}>
                      ฿{fmt(p.online_price != null ? p.online_price : p.price)}
                    </p>
                    {p.online_price != null && p.online_price < p.price && (
                      <p className="text-xs text-slate-400 line-through">฿{fmt(p.price)}</p>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {p.categories?.name && <span className="mr-1">• {p.categories.name}</span>}
                    {p.stock <= 0
                      ? <span className="text-red-500 font-medium">สินค้าหมด</span>
                      : `คงเหลือ ${fmt(p.stock)} ${p.unit}`
                    }
                  </p>
                  <button
                    onClick={() => setQrOpen(true)}
                    className="mt-2.5 w-full text-white text-xs font-semibold py-2 rounded-xl"
                    style={{ background: '#06C755' }}
                  >
                    💬 สอบถาม / สั่งซื้อ
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        {!loading && (
          <div className="text-center mt-8 mb-4 space-y-1">
            <p className="text-xs text-slate-400">{shop.shop_name}</p>
            {shop.shop_address && <p className="text-xs text-slate-400">{shop.shop_address}</p>}
            {shop.shop_phone && <p className="text-xs text-slate-400">📞 {shop.shop_phone}</p>}
          </div>
        )}
      </div>

      {/* LINE QR Modal */}
      {qrOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6"
          onClick={() => setQrOpen(false)}
        >
          <div className="bg-white rounded-2xl p-6 max-w-xs w-full text-center shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-slate-800 mb-1">ติดต่อสั่งซื้อ</p>
            <p className="text-sm text-slate-500 mb-4">แสกน QR เพื่อคุยกับร้านทาง LINE</p>
            {shop.line_qr ? (
              <img src={shop.line_qr} alt="LINE QR" className="w-full rounded-xl border border-slate-100" />
            ) : (
              <p className="text-slate-400 text-sm py-8">ไม่พบ QR Code LINE</p>
            )}
            {shop.shop_phone && (
              <a
                href={`tel:${shop.shop_phone}`}
                className="mt-4 flex items-center justify-center gap-2 w-full py-3 rounded-xl text-white text-sm font-semibold"
                style={{ background: '#C72C41' }}
              >
                📞 โทร {shop.shop_phone}
              </a>
            )}
            <button onClick={() => setQrOpen(false)} className="mt-2 text-slate-400 text-sm w-full py-2">ปิด</button>
          </div>
        </div>
      )}
    </div>
  )
}
