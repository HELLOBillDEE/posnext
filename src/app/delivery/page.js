'use client'
import { useEffect, useState } from 'react'

function fmt(n) { return Number(n||0).toLocaleString('th-TH') }
function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleDateString('th-TH', { day:'numeric', month:'short' }) + ' ' +
    d.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' })
}

export default function DeliveryListPage() {
  const [docs, setDocs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pending') // pending | done

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/delivery/list', { cache: 'no-store' })
      const data = await res.json()
      setDocs(data || [])
    } catch {
      setDocs([])
    } finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const pending = (docs||[]).filter(d => !d.delivered_at && d.status !== 'delivered' && d.status !== 'cancelled')
  const done    = (docs||[]).filter(d => !!d.delivered_at || d.status === 'delivered')

  const list = tab === 'pending' ? pending : done

  return (
    <div className="min-h-screen bg-slate-50 pb-8" style={{fontFamily:'system-ui,sans-serif'}}>
      {/* Header */}
      <div style={{background:'#C72C41'}} className="text-white px-4 pt-10 pb-4">
        <h1 className="text-xl font-bold">📦 รายการส่งของ</h1>
        <p className="text-sm opacity-75 mt-0.5">เลือกรายการเพื่อปิดงาน</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 bg-white sticky top-0 z-10">
        {[['pending','🕐 รอส่ง'], ['done','✅ ส่งแล้ว']].map(([t,l]) => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-3 text-sm font-semibold transition-colors"
            style={{color: tab===t ? '#C72C41' : '#94a3b8', borderBottom: tab===t ? '2px solid #C72C41' : '2px solid transparent'}}>
            {l}
            {t==='pending' && docs && pending.length > 0 && (
              <span className="ml-1.5 bg-red-100 text-red-600 text-xs font-bold px-1.5 py-0.5 rounded-full">{pending.length}</span>
            )}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && list.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">{tab==='pending' ? '🎉' : '📋'}</div>
          <p className="text-sm">{tab==='pending' ? 'ไม่มีรายการรอส่ง' : 'ยังไม่มีประวัติการส่ง'}</p>
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {list.map(doc => (
          <a key={doc.id} href={doc.delivery_token ? `/delivery/${doc.delivery_token}` : '#'}
            onClick={async e => {
              if (!doc.delivery_token) {
                e.preventDefault()
                const res = await fetch('/api/delivery', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id:doc.id}) })
                const { token } = await res.json()
                window.location.href = `/delivery/${token}`
              }
            }}
            className="flex items-center gap-3 px-4 py-4 bg-white active:bg-slate-50 transition-colors">

            {/* Status dot */}
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{background: doc.delivered_at ? '#22c55e' : '#f97316'}} />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-800">{doc.doc_no}</span>
                {doc.delivered_at && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">ส่งแล้ว</span>}
              </div>
              <p className="text-sm text-slate-600 truncate mt-0.5">{doc.customer_name}</p>
              {doc.customer_address && <p className="text-xs text-slate-400 truncate">{doc.customer_address}</p>}
              <p className="text-xs text-slate-400 mt-0.5">
                {doc.delivered_at ? '✅ ' + fmtDate(doc.delivered_at) : '📅 ' + fmtDate(doc.created_at)}
              </p>
            </div>

            <div className="text-right flex-shrink-0">
              <p className="text-sm font-bold" style={{color:'#C72C41'}}>฿{fmt(doc.total)}</p>
              {doc.delivery_fee > 0 && <p className="text-xs text-slate-400">+฿{fmt(doc.delivery_fee)} ส่ง</p>}
              <span className="text-slate-300 text-lg mt-1 block">›</span>
            </div>
          </a>
        ))}
      </div>

      {/* Refresh */}
      {!loading && (
        <div className="flex justify-center py-6">
          <button onClick={load} className="text-sm text-slate-400 flex items-center gap-2">
            🔄 รีเฟรช
          </button>
        </div>
      )}
    </div>
  )
}
