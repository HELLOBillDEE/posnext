'use client'
import { useEffect, useState } from 'react'

function fmt(n) { return Number(n||0).toLocaleString('th-TH') }
function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleDateString('th-TH', { day:'numeric', month:'short' }) + ' ' +
    d.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' })
}
function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}
function nearestNeighbor(startLat, startLng, items) {
  const withCoord = items.filter(d => d.customer_lat && d.customer_lng)
  const noCoord   = items.filter(d => !d.customer_lat || !d.customer_lng)
  const unvisited = [...withCoord]
  const route = []
  let curLat = startLat, curLng = startLng
  while (unvisited.length > 0) {
    let best = 0, bestDist = Infinity
    unvisited.forEach((d, i) => {
      const dist = distKm(curLat, curLng, Number(d.customer_lat), Number(d.customer_lng))
      if (dist < bestDist) { bestDist = dist; best = i }
    })
    const chosen = unvisited.splice(best, 1)[0]
    route.push({ ...chosen, _distKm: bestDist })
    curLat = Number(chosen.customer_lat); curLng = Number(chosen.customer_lng)
  }
  return [...route, ...noCoord.map(d => ({ ...d, _distKm: null }))]
}

export default function DeliveryListPage() {
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('pending')
  const [pending, setPending]   = useState([])
  const [done, setDone]         = useState([])

  // Route planning
  const [routeMode, setRouteMode]       = useState(false)
  const [selected, setSelected]         = useState(new Set())
  const [routeOrder, setRouteOrder]     = useState(null) // sorted array when planned
  const [planningGps, setPlanningGps]   = useState(false)
  const [gpsError, setGpsError]         = useState('')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/delivery/list', { cache: 'no-store' })
      const data = await res.json()
      setPending(data.pending || [])
      setDone(data.done || [])
    } catch {
      setPending([]); setDone([])
    } finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  function toggleRouteMode() {
    setRouteMode(v => !v)
    setSelected(new Set())
    setRouteOrder(null)
    setGpsError('')
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setRouteOrder(null)
  }

  function selectAll() {
    setSelected(new Set(pending.map(d => d.id)))
    setRouteOrder(null)
  }

  function planRoute() {
    if (selected.size === 0) return
    setPlanningGps(true)
    setGpsError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords
        const items = pending.filter(d => selected.has(d.id))
        const sorted = nearestNeighbor(latitude, longitude, items)
        setRouteOrder(sorted)
        setPlanningGps(false)
      },
      err => {
        // fallback: sort by lat/lng among themselves without GPS
        const items = pending.filter(d => selected.has(d.id))
        const withCoord = items.filter(d => d.customer_lat && d.customer_lng)
        if (withCoord.length > 0) {
          const first = withCoord[0]
          const sorted = nearestNeighbor(Number(first.customer_lat), Number(first.customer_lng), items)
          setRouteOrder(sorted)
        } else {
          setRouteOrder(items)
        }
        setGpsError('ไม่สามารถขอ GPS ได้ — เรียงจากพิกัดลูกค้าแทน')
        setPlanningGps(false)
      },
      { timeout: 8000, enableHighAccuracy: false }
    )
  }

  function openMapsAll() {
    const list = routeOrder || pending.filter(d => selected.has(d.id))
    if (list.length === 0) return
    const stops = list.map(d =>
      d.customer_lat && d.customer_lng
        ? `${d.customer_lat},${d.customer_lng}`
        : encodeURIComponent(d.customer_address || d.customer_name)
    )
    const url = `https://www.google.com/maps/dir/${stops.join('/')}`
    window.open(url, '_blank')
  }

  const renderList = routeOrder
    ? routeOrder
    : (routeMode ? pending : (tab === 'pending' ? pending : done))

  return (
    <div className="min-h-screen bg-slate-50 pb-24" style={{fontFamily:'system-ui,sans-serif'}}>
      {/* Header */}
      <div style={{background:'#C72C41'}} className="text-white px-4 pt-10 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">📦 รายการส่งของ</h1>
            <p className="text-sm opacity-75 mt-0.5">
              {routeMode ? 'เลือกคิวที่จะส่งวันนี้' : 'เลือกรายการเพื่อปิดงาน'}
            </p>
          </div>
          {tab === 'pending' && (
            <button onClick={toggleRouteMode}
              className="text-sm font-bold px-3 py-1.5 rounded-full transition-colors"
              style={{background: routeMode ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.2)', color: routeMode ? '#C72C41' : 'white'}}>
              {routeMode ? '✕ ยกเลิก' : '🗺️ จัดเส้นทาง'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      {!routeMode && (
        <div className="flex border-b border-slate-200 bg-white sticky top-0 z-10">
          {[['pending','🕐 รอส่ง'], ['done','✅ ส่งแล้ว']].map(([t,l]) => (
            <button key={t} onClick={() => { setTab(t); setRouteOrder(null) }}
              className="flex-1 py-3 text-sm font-semibold transition-colors"
              style={{color: tab===t ? '#C72C41' : '#94a3b8', borderBottom: tab===t ? '2px solid #C72C41' : '2px solid transparent'}}>
              {l}
              {t==='pending' && pending.length > 0 && (
                <span className="ml-1.5 bg-red-100 text-red-600 text-xs font-bold px-1.5 py-0.5 rounded-full">{pending.length}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Route mode toolbar */}
      {routeMode && (
        <div className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-10 space-y-2">
          <div className="flex items-center gap-2">
            <button onClick={selectAll}
              className="text-xs text-blue-600 font-semibold border border-blue-200 px-2.5 py-1 rounded-lg">
              เลือกทั้งหมด ({pending.length})
            </button>
            <span className="text-xs text-slate-400">เลือกแล้ว {selected.size} คิว</span>
          </div>
          {gpsError && <p className="text-xs text-amber-600">⚠️ {gpsError}</p>}
          <div className="flex gap-2">
            <button onClick={planRoute} disabled={selected.size === 0 || planningGps}
              className="flex-1 text-sm font-bold py-2.5 rounded-xl transition-colors disabled:opacity-40"
              style={{background:'#C72C41', color:'white'}}>
              {planningGps ? '📍 กำลังหาตำแหน่ง...' : `📍 จัดเส้นทาง ${selected.size > 0 ? `(${selected.size})` : ''}`}
            </button>
            {routeOrder && (
              <button onClick={openMapsAll}
                className="flex-1 text-sm font-bold py-2.5 rounded-xl"
                style={{background:'#1a73e8', color:'white'}}>
                🗺️ เปิด Maps
              </button>
            )}
          </div>
          {routeOrder && (
            <p className="text-xs text-green-600 font-semibold text-center">
              ✅ จัดเส้นทางแล้ว {routeOrder.length} จุด — เรียงตามระยะทางใกล้-ไกล
            </p>
          )}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && renderList.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">{tab==='pending' ? '🎉' : '📋'}</div>
          <p className="text-sm">{tab==='pending' ? 'ไม่มีรายการรอส่ง' : 'ยังไม่มีประวัติการส่ง'}</p>
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {renderList.map((doc, idx) => {
          const isSelected = selected.has(doc.id)

          return (
            <div key={doc.id} className="flex items-center bg-white active:bg-slate-50">
              {/* Checkbox in route mode */}
              {routeMode && !routeOrder && (
                <button onClick={() => toggleSelect(doc.id)}
                  className="pl-4 pr-2 py-4 flex-shrink-0"
                  style={{color: isSelected ? '#C72C41' : '#cbd5e1'}}>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'border-red-500 bg-red-500' : 'border-slate-300'}`}>
                    {isSelected && <span className="text-white text-xs font-bold">✓</span>}
                  </div>
                </button>
              )}

              {/* Order number when route planned */}
              {routeOrder && (
                <div className="pl-4 pr-2 flex-shrink-0">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{background: doc._distKm != null ? '#C72C41' : '#94a3b8'}}>
                    {idx + 1}
                  </div>
                </div>
              )}

              <a href={doc.delivery_token ? `/delivery/${doc.delivery_token}` : '#'}
                onClick={async e => {
                  if (routeMode && !routeOrder) { e.preventDefault(); toggleSelect(doc.id); return }
                  if (!doc.delivery_token) {
                    e.preventDefault()
                    const res = await fetch('/api/delivery', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id:doc.id}) })
                    const { token } = await res.json()
                    window.location.href = `/delivery/${token}`
                  }
                }}
                className="flex-1 flex items-center gap-3 px-3 py-4 min-w-0">

                {/* Status dot (non-route mode) */}
                {!routeMode && (
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{background: doc.delivered_at ? '#22c55e' : '#f97316'}} />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-800">{doc.doc_no}</span>
                    {doc.delivered_at && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">ส่งแล้ว</span>}
                    {doc._distKm != null && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">
                        ~{doc._distKm < 1 ? `${Math.round(doc._distKm*1000)} ม.` : `${doc._distKm.toFixed(1)} กม.`}
                      </span>
                    )}
                    {doc._distKm == null && routeOrder && (
                      <span className="text-xs bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full">ไม่มีพิกัด</span>
                    )}
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
            </div>
          )
        })}
      </div>

      {/* Refresh */}
      {!loading && !routeMode && (
        <div className="flex justify-center py-6">
          <button onClick={load} className="text-sm text-slate-400 flex items-center gap-2">
            🔄 รีเฟรช
          </button>
        </div>
      )}
    </div>
  )
}
