'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
}

export default function TrackPage({ params }) {
  const { token } = params
  const [live, setLive]     = useState(null)  // { lat, lng, ts }
  const [trail, setTrail]   = useState([])    // [{lat,lng,recorded_at}] from DB
  const [connected, setConnected] = useState(false)
  const [lastSeen, setLastSeen]   = useState(null)
  const channelRef = useRef(null)

  // โหลด trail จาก DB
  async function loadTrail() {
    const res = await fetch(`/api/delivery/location?token=${token}`).then(r => r.json())
    setTrail(res.points || [])
    if ((res.points||[]).length > 0) {
      const last = res.points[res.points.length - 1]
      setLive({ lat: Number(last.lat), lng: Number(last.lng), ts: new Date(last.recorded_at).getTime() })
    }
  }

  useEffect(() => {
    loadTrail()

    // Subscribe Supabase Realtime broadcast
    const ch = sb.channel(`delivery-location-${token}`)
      .on('broadcast', { event: 'location' }, ({ payload }) => {
        setLive({ lat: payload.lat, lng: payload.lng, ts: payload.ts || Date.now() })
        setLastSeen(new Date())
        setTrail(prev => [...prev, { lat: payload.lat, lng: payload.lng, recorded_at: new Date().toISOString() }])
      })
      .subscribe(status => {
        setConnected(status === 'SUBSCRIBED')
      })

    channelRef.current = ch
    return () => { sb.removeChannel(ch) }
  }, [token])

  const mapsEmbedUrl = live
    ? `https://maps.google.com/maps?q=${live.lat},${live.lng}&z=15&output=embed`
    : null

  const mapsOpenUrl = live
    ? `https://www.google.com/maps?q=${live.lat},${live.lng}`
    : null

  return (
    <div className="min-h-screen bg-slate-900 text-white" style={{fontFamily:'system-ui,sans-serif'}}>
      {/* Header */}
      <div className="px-4 pt-10 pb-4" style={{background:'#C72C41'}}>
        <h1 className="text-lg font-bold">📡 ติดตามการส่งของ</h1>
        <div className="flex items-center gap-2 mt-1">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-slate-400'}`} />
          <p className="text-xs opacity-80">{connected ? 'เชื่อมต่อแล้ว — รอรับตำแหน่ง' : 'กำลังเชื่อมต่อ...'}</p>
        </div>
        {lastSeen && <p className="text-xs opacity-60 mt-0.5">อัพเดตล่าสุด: {fmtTime(lastSeen)}</p>}
      </div>

      {/* แผนที่ */}
      <div className="relative" style={{height: '55vh'}}>
        {mapsEmbedUrl
          ? <iframe key={mapsEmbedUrl} src={mapsEmbedUrl} width="100%" height="100%" style={{border:0}} allowFullScreen loading="lazy" />
          : <div className="w-full h-full flex flex-col items-center justify-center bg-slate-800 gap-3">
              <p className="text-4xl">📍</p>
              <p className="text-slate-400 text-sm">รอรับตำแหน่งจากคนส่งของ...</p>
              <p className="text-slate-500 text-xs">คนส่งต้องกด "เริ่มติดตาม" บนหน้าบิลส่งของ</p>
            </div>
        }
      </div>

      {/* ข้อมูล + trail */}
      <div className="px-4 py-4 space-y-3">

        {live && (
          <div className="bg-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 mb-1">ตำแหน่งล่าสุด</p>
              <p className="text-sm font-mono">{live.lat.toFixed(6)}, {live.lng.toFixed(6)}</p>
              {lastSeen && <p className="text-xs text-slate-400 mt-1">เมื่อ {fmtTime(lastSeen)}</p>}
            </div>
            {mapsOpenUrl && (
              <a href={mapsOpenUrl} target="_blank" rel="noopener noreferrer"
                className="px-3 py-2 rounded-lg text-sm font-semibold text-white flex-shrink-0"
                style={{background:'#1a73e8'}}>🗺️ เปิด Maps</a>
            )}
          </div>
        )}

        {trail.length > 0 && (
          <div className="bg-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700">
              <p className="text-sm font-semibold">🛣️ เส้นทาง ({trail.length} จุด)</p>
            </div>
            <div className="max-h-52 overflow-y-auto divide-y divide-slate-700">
              {[...trail].reverse().map((p, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                  <p className="text-xs font-mono text-slate-300">{Number(p.lat).toFixed(5)}, {Number(p.lng).toFixed(5)}</p>
                  <p className="text-xs text-slate-500">{fmtTime(new Date(p.recorded_at))}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={loadTrail}
          className="w-full py-2.5 rounded-xl text-sm text-slate-400 border border-slate-700">
          🔄 รีเฟรช trail
        </button>
      </div>
    </div>
  )
}
