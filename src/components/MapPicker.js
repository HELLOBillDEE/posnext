'use client'
import { useEffect, useRef, useState } from 'react'

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function getRoadDistance(shopLat, shopLng, custLat, custLng) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${shopLng},${shopLat};${custLng},${custLat}?overview=false`
    const res = await fetch(url, { headers: { 'User-Agent': 'POSNEXT/1.0' } })
    const data = await res.json()
    if (data.routes?.[0]?.distance) return data.routes[0].distance / 1000
  } catch {}
  return null
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=th`,
      { headers: { 'User-Agent': 'POSNEXT/1.0' } }
    )
    const data = await res.json()
    return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }
}

// คำนวณ tile x,y จาก lat/lng/zoom
function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom)
  const x = Math.floor((lng + 180) / 360 * n)
  const latRad = lat * Math.PI / 180
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
  const fx = (lng + 180) / 360 * n - x
  const fy = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - y
  return { x, y, n, fx, fy }
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function drawArrow(ctx, cx, cy, angleDeg, len, color, width = 2) {
  const rad = (angleDeg - 90) * Math.PI / 180
  const ex = cx + Math.cos(rad) * len
  const ey = cy + Math.sin(rad) * len
  ctx.save()
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke()
  // arrowhead
  const hw = 6, hl = 10
  const ang = Math.atan2(ey - cy, ex - cx)
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - hl * Math.cos(ang - 0.4), ey - hl * Math.sin(ang - 0.4))
  ctx.lineTo(ex - hl * Math.cos(ang + 0.4), ey - hl * Math.sin(ang + 0.4))
  ctx.closePath(); ctx.fill()
  ctx.restore()
}

// lat/lng → pixel บน canvas
function latlngToPixel(plat, plng, zoom, offX, offY, tX, tY) {
  const T = 256, n = Math.pow(2, zoom)
  const ptX = (plng + 180) / 360 * n
  const latRad = plat * Math.PI / 180
  const ptY = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
  return { px: Math.round(offX + (ptX - tX) * T), py: Math.round(offY + (ptY - tY) * T) }
}

// fetch tile เป็น blob → drawImage ไม่มีปัญหา canvas tainted
async function captureMap(lat, lng, zoom = 15, shopLat = null, shopLng = null, info = {}) {
  const W = 576, H = 400, T = 256
  const { x: tX, y: tY, n, fx, fy } = latLngToTile(lat, lng, zoom)
  const offX = W / 2 - fx * T
  const offY = H / 2 - fy * T
  const r = 2

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#f0ede5'; ctx.fillRect(0, 0, W, H)

  await Promise.all(
    Array.from({ length: (r * 2 + 1) ** 2 }, (_, i) => {
      const dx = (i % (r * 2 + 1)) - r
      const dy = Math.floor(i / (r * 2 + 1)) - r
      const tx = tX + dx, ty = tY + dy
      if (ty < 0 || ty >= n) return Promise.resolve()
      const drawX = Math.round(offX + dx * T)
      const drawY = Math.round(offY + dy * T)
      if (drawX + T < 0 || drawX > W || drawY + T < 0 || drawY > H) return Promise.resolve()
      return fetch(`/api/osm-tile/${zoom}/${tx}/${ty}.png`)
        .then(r => r.blob())
        .then(blob => new Promise(res => {
          const url = URL.createObjectURL(blob)
          const img = new Image()
          img.onload = () => { ctx.drawImage(img, drawX, drawY); URL.revokeObjectURL(url); res() }
          img.onerror = res
          img.src = url
        }))
        .catch(() => {})
    })
  )

  // marker "ที่นี่" — ลูกโป่งลอยเหนือพิกัด + ลูกศรชี้จุดจริง
  const cx = W / 2, cy = H / 2
  const mr = 22           // รัศมีวงกลม label
  const labelY = cy - 54  // ลอยขึ้น

  // จุดพิกัดจริง — dot เล็ก
  ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2)
  ctx.fillStyle = '#000'; ctx.fill()

  // เส้นลูกศรจากวงล่างถึงจุดพิกัด
  ctx.beginPath()
  ctx.moveTo(cx, labelY + mr)
  ctx.lineTo(cx, cy - 6)
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke()

  // หัวลูกศร (สามเหลี่ยมชี้ลง)
  ctx.beginPath()
  ctx.moveTo(cx, cy - 1)
  ctx.lineTo(cx - 5, cy - 9)
  ctx.lineTo(cx + 5, cy - 9)
  ctx.closePath()
  ctx.fillStyle = '#000'; ctx.fill()

  // วงกลม label
  ctx.beginPath(); ctx.arc(cx, labelY, mr, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'; ctx.fill()
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5; ctx.stroke()
  ctx.fillStyle = '#000'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('ที่นี่', cx, labelY)
  ctx.textBaseline = 'alphabetic'

  // ─── compass (top-left, ใหญ่ชัดเจน) ───
  const cr = 36, ox = cr + 14, oy = cr + 14
  // พื้นหลังขาว
  ctx.beginPath(); ctx.arc(ox, oy, cr + 2, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill()
  ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1.5; ctx.stroke()
  // เข็มเหนือ (แดง) — สามเหลี่ยมชี้ขึ้น
  ctx.beginPath()
  ctx.moveTo(ox, oy - cr + 2)
  ctx.lineTo(ox - 7, oy)
  ctx.lineTo(ox + 7, oy)
  ctx.closePath()
  ctx.fillStyle = '#dc2626'; ctx.fill()
  // เข็มใต้ (เทา) — สามเหลี่ยมชี้ลง
  ctx.beginPath()
  ctx.moveTo(ox, oy + cr - 2)
  ctx.lineTo(ox - 7, oy)
  ctx.lineTo(ox + 7, oy)
  ctx.closePath()
  ctx.fillStyle = '#9ca3af'; ctx.fill()
  // วงกลมกลาง
  ctx.beginPath(); ctx.arc(ox, oy, 5, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'; ctx.fill()
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5; ctx.stroke()
  // label เหนือ/ใต้/ออก/ตก
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = 'bold 12px sans-serif'
  ctx.fillStyle = '#dc2626'
  ctx.fillText('เหนือ', ox, oy - cr - 10) // เหนือ
  ctx.fillStyle = '#555'; ctx.font = '11px sans-serif'
  ctx.fillText('ใต้', ox, oy + cr + 10)              // ใต้
  ctx.fillText('ออก', ox + cr + 12, oy)              // ออก
  ctx.fillText('ตก', ox - cr - 10, oy)                    // ตก
  // tick marks E/W
  ;[[90], [270]].forEach(([a]) => {
    const rad = (a - 90) * Math.PI / 180
    ctx.beginPath()
    ctx.moveTo(ox + Math.cos(rad) * (cr - 6), oy + Math.sin(rad) * (cr - 6))
    ctx.lineTo(ox + Math.cos(rad) * cr, oy + Math.sin(rad) * cr)
    ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 2; ctx.stroke()
  })
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'

  // ─── nearby POI จาก Overpass API ───
  try {
    const overpassQ = `[out:json][timeout:5];node(around:600,${lat},${lng})[name][~"^(amenity|shop|tourism|highway|landuse)$"~"."];out 12;`
    const ovRes = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: overpassQ,
      signal: AbortSignal.timeout(6000),
    })
    if (ovRes.ok) {
      const ovData = await ovRes.json()
      const pois = (ovData.elements || []).filter(e => e.lat && e.lon && e.tags?.name)
      pois.forEach(poi => {
        const { px, py } = latlngToPixel(poi.lat, poi.lon, zoom, offX, offY, tX, tY)
        if (px < 0 || px > W || py < 0 || py > H) return
        // dot
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#f97316'; ctx.fill()
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
        // label พื้นหลัง
        const label = poi.tags.name.slice(0, 20)
        ctx.font = '10px sans-serif'
        const tw = ctx.measureText(label).width
        const lx = Math.min(Math.max(px - tw / 2, 2), W - tw - 2)
        const ly = py - 10
        ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fillRect(lx - 2, ly - 11, tw + 4, 13)
        ctx.fillStyle = '#7c2d12'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
        ctx.fillText(label, lx, ly)
      })
    }
  } catch { /* Overpass timeout — ข้ามได้ */ }

  // ─── info box (พื้นขาว ตัวดำ — พิมพ์ thermal ได้ชัด) ───
  const { name, phone, address: addr } = info
  if (name || addr) {
    const lines = []
    if (name) lines.push(phone ? `${name}   ${phone}` : name)
    if (addr) for (let i = 0; i < addr.length; i += 56) lines.push(addr.slice(i, i + 56))
    const lh = 16, pad = 6, boxH = lines.length * lh + pad * 2
    const boxY = H - boxH - 18
    // พื้นขาวกึ่งโปร่ง
    ctx.fillStyle = 'rgba(255,255,255,0.90)'; ctx.fillRect(0, boxY, W, boxH)
    // เส้นขอบบน
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, boxY); ctx.lineTo(W, boxY); ctx.stroke()
    // ตัวหนังสือดำ
    ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#111'
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    lines.forEach((l, i) => {
      if (i === 0) ctx.font = 'bold 12px sans-serif'
      else ctx.font = '11px sans-serif'
      ctx.fillText(l, pad, boxY + pad + i * lh)
    })
    ctx.textBaseline = 'alphabetic'
  }

  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(0, H - 16, W, 16)
  ctx.fillStyle = '#555'; ctx.font = '9px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'
  ctx.fillText('© OpenStreetMap contributors', W - 4, H - 4)

  // หมุน 90° clockwise → portrait (H×W)
  const rotated = document.createElement('canvas')
  rotated.width = H; rotated.height = W
  const rCtx = rotated.getContext('2d')
  rCtx.translate(H, 0)
  rCtx.rotate(Math.PI / 2)
  rCtx.drawImage(canvas, 0, 0)
  return rotated.toDataURL('image/jpeg', 0.92)
}

export default function MapPicker({ shopLat, shopLng, initialLat, initialLng, initialAddress, onConfirm, onClose, custName, custPhone }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markerRef = useRef(null)
  const latRef = useRef(initialLat || shopLat)
  const lngRef = useRef(initialLng || shopLng)
  const [address, setAddress] = useState(initialAddress || '')
  const [searchInput, setSearchInput] = useState('')
  const [distance, setDistance] = useState(
    initialLat ? haversine(shopLat, shopLng, initialLat, initialLng) : 0
  )
  const [roadDistance, setRoadDistance] = useState(null)
  const [searching, setSearching] = useState(false)
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (mapInstanceRef.current) return

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }

    async function init() {
      const L = (await import('leaflet')).default
      delete L.Icon.Default.prototype._getIconUrl
      L.Icon.Default.mergeOptions({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const initLat = latRef.current
      const initLng = lngRef.current
      const map = L.map(mapRef.current, { zoomControl: true }).setView([initLat, initLng], 16)

      L.tileLayer(
        '/api/osm-tile/{z}/{x}/{y}.png',
        { attribution: '© OpenStreetMap contributors', maxNativeZoom: 19, maxZoom: 19, crossOrigin: 'anonymous' }
      ).addTo(map)

      const shopIcon = L.divIcon({
        className: '',
        html: `<div style="width:16px;height:16px;background:#ef4444;border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8],
      })
      L.marker([shopLat, shopLng], { icon: shopIcon }).addTo(map).bindPopup('🏪 ร้านค้า')

      const custMarker = L.marker([initLat, initLng], { draggable: true }).addTo(map)
      markerRef.current = custMarker

      async function updatePos(nlat, nlng) {
        latRef.current = nlat; lngRef.current = nlng
        setDistance(haversine(shopLat, shopLng, nlat, nlng))
        setRoadDistance(null)
        const [addr] = await Promise.all([
          reverseGeocode(nlat, nlng),
          getRoadDistance(shopLat, shopLng, nlat, nlng).then(d => { if (d) setRoadDistance(d) }),
        ])
        setAddress(addr)
      }

      custMarker.on('dragend', (e) => {
        const { lat, lng } = e.target.getLatLng()
        updatePos(lat, lng)
      })
      map.on('click', (e) => {
        const { lat, lng } = e.latlng
        custMarker.setLatLng([lat, lng])
        updatePos(lat, lng)
      })

      mapInstanceRef.current = map
    }
    init()

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  async function search() {
    if (!searchInput.trim()) return
    setSearching(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchInput)}&format=json&limit=1&accept-language=th`,
        { headers: { 'User-Agent': 'POSNEXT/1.0' } }
      )
      const results = await res.json()
      if (results.length > 0) {
        const { lat: rlat, lon: rlng, display_name } = results[0]
        const nlat = parseFloat(rlat), nlng = parseFloat(rlng)
        latRef.current = nlat; lngRef.current = nlng
        mapInstanceRef.current?.setView([nlat, nlng], 15)
        markerRef.current?.setLatLng([nlat, nlng])
        setAddress(display_name)
        setDistance(haversine(shopLat, shopLng, nlat, nlng))
      } else {
        alert('ไม่พบสถานที่ ลองพิมพ์ให้ชัดเจนขึ้น')
      }
    } catch { alert('ค้นหาไม่ได้ ตรวจสอบอินเตอร์เน็ต') }
    finally { setSearching(false) }
  }

  async function confirm() {
    setCapturing(true)
    try {
      let finalRoadDist = roadDistance
      if (!finalRoadDist) {
        finalRoadDist = await getRoadDistance(shopLat, shopLng, latRef.current, lngRef.current)
        if (finalRoadDist) setRoadDistance(finalRoadDist)
      }
      const useDist = finalRoadDist || distance
      const mapImageDataUrl = await captureMap(
        latRef.current, lngRef.current, 15, shopLat, shopLng,
        { name: custName, phone: custPhone, address, distKm: useDist }
      )
      onConfirm({
        lat: latRef.current,
        lng: lngRef.current,
        address,
        distanceKm: useDist,
        isRoadDistance: !!finalRoadDist,
        mapImageDataUrl,
      })
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black">
      <div className="bg-white px-3 py-2 flex items-center gap-2 flex-shrink-0 shadow">
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-xl text-slate-500 flex-shrink-0">×</button>
        <input
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="ค้นหาสถานที่..."
          className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <button onClick={search} disabled={searching}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 flex-shrink-0">
          {searching ? '...' : '🔍'}
        </button>
      </div>

      <div ref={mapRef} style={{ flex: 1 }} />

      <div className="bg-white px-4 py-3 flex-shrink-0 shadow-[0_-2px_8px_rgba(0,0,0,.08)] space-y-2">
        <p className="text-xs text-slate-500 line-clamp-2 min-h-[2.5em]">
          {address || 'กดบนแผนที่ หรือลากหมุดเพื่อเลือกตำแหน่ง'}
        </p>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm leading-tight">
            {roadDistance ? (
              <>
                <span className="font-bold text-blue-700">{roadDistance.toFixed(1)} กม.</span>
                <span className="text-slate-400 text-xs"> (ทางถนน) ไป-กลับ {(roadDistance * 2).toFixed(1)} กม.</span>
              </>
            ) : (
              <>
                <span className="font-bold text-blue-700">{distance.toFixed(1)} กม.</span>
                <span className="text-slate-400 text-xs"> (เส้นตรง) กำลังคำนวนทางถนน...</span>
              </>
            )}
          </div>
          <button onClick={confirm} disabled={capturing}
            className="bg-blue-700 text-white px-6 py-2.5 rounded-2xl text-sm font-bold active:scale-95 transition-transform disabled:opacity-60">
            {capturing ? '⏳ กำลังบันทึกแผนที่...' : '✓ ยืนยันตำแหน่ง'}
          </button>
        </div>
      </div>
    </div>
  )
}
