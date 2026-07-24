export const dynamic = 'force-dynamic'

export function GET(request) {
  const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const url = new URL(request.url)
  const t1 = url.searchParams.get('t1') || 'pos1'
  const t2 = url.searchParams.get('t2') || 'pos2'
  const CH1 = 'customer-display-' + t1
  const CH2 = 'customer-display-' + t2

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Dual Customer Display</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:100%;height:100%;overflow:hidden;background:#0f172a;}
body{font-family:'Kanit',sans-serif;}
#app{display:grid;grid-template-columns:1fr 1fr 1fr;width:100vw;height:100vh;}

/* ── CENTER MEDIA ── */
.med{position:relative;overflow:hidden;background:#000;}
.med video{width:100%;height:100%;object-fit:cover;}
.med .slides{width:100%;height:100%;position:relative;}
.med .slide{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 1.2s;}
.med .slide.on{opacity:1;}
.med .slide img{width:100%;height:100%;object-fit:cover;}
.med .no-media{width:100%;height:100%;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;}
.med .no-media .logo-wrap{width:160px;height:160px;display:flex;align-items:center;justify-content:center;}
.med .no-media .logo-wrap img{max-width:100%;max-height:100%;object-fit:contain;}
.med .no-media .wlc{font-size:22px;color:rgba(255,255,255,0.7);text-align:center;}
.med-mute{position:absolute;bottom:12px;right:12px;background:rgba(0,0,0,0.5);color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;user-select:none;z-index:10;}

/* ── POS PANEL BASE ── */
.pos{display:flex;flex-direction:column;overflow:hidden;transition:opacity .4s;}
.pos.idle-dim{opacity:.55;}

/* IDLE */
.pos-idle{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;background:#fff;}
.pos-idle .logo-wrap{max-width:80%;max-height:140px;display:flex;align-items:center;justify-content:center;}
.pos-idle .logo-wrap img{max-width:100%;max-height:140px;object-fit:contain;}
.pos-idle .wlc{font-size:18px;color:#94a3b8;text-align:center;}
.pos-idle .tid{font-size:11px;color:#cbd5e1;margin-top:4px;}

/* ACTIVE — cart */
.pos-active{flex:1;display:flex;flex-direction:column;background:#f8fafc;}
.pos-hdr{background:linear-gradient(135deg,#C72C41,#801336);color:#fff;padding:12px 14px;flex-shrink:0;}
.pos-hdr h2{font-size:17px;font-weight:700;}
.pos-body{flex:1;overflow-y:auto;padding:8px;}
.pos-body::-webkit-scrollbar{display:none;}
.ci{display:flex;justify-content:space-between;align-items:center;background:#fff;border-radius:8px;padding:10px 12px;margin-bottom:6px;box-shadow:0 1px 3px rgba(0,0,0,.07);}
.ci-name{font-size:15px;font-weight:600;color:#1e293b;}
.ci-unit{font-size:12px;color:#94a3b8;margin-top:1px;}
.ci-tot{font-size:17px;font-weight:700;color:#C72C41;flex-shrink:0;}
.pos-total{background:linear-gradient(160deg,#C72C41,#801336);color:#fff;padding:16px;flex-shrink:0;text-align:center;}
.pos-total .lbl{font-size:14px;opacity:.8;}
.pos-total .amt{font-size:44px;font-weight:800;line-height:1.1;}
.pos-total .disc{font-size:13px;opacity:.7;}

/* PAYING */
.pos-paying{flex:1;background:linear-gradient(135deg,#0f172a,#1e293b);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#fff;}
.pos-paying .ic{font-size:52px;}
.pos-paying .t1{font-size:18px;opacity:.75;}
.pos-paying .t2{font-size:46px;font-weight:800;}

/* QR */
.pos-qr{flex:1;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;}
.pos-qr .qt{font-size:14px;color:#64748b;}
.pos-qr img{width:min(200px,80%);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.1);}
.pos-qr .qa{font-size:20px;font-weight:800;color:#0369a1;}

/* PAID */
.pos-paid{flex:1;background:linear-gradient(135deg,#f0f9ff,#e0f2fe);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:20px;text-align:center;}
.pos-paid .ic{font-size:56px;margin-bottom:4px;}
.pos-paid .p1{font-size:20px;color:#C72C41;font-weight:700;}
.pos-paid .p2{font-size:36px;font-weight:800;color:#0f172a;line-height:1.1;}
.pos-paid .p3{font-size:28px;font-weight:700;color:#0f172a;}
.pos-paid .p4{font-size:14px;color:#64748b;margin-top:6px;}
</style>
</head>
<body>
<div id="app">
  <div id="p1" class="pos"></div>
  <div id="med" class="med"></div>
  <div id="p2" class="pos"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script>
const SURL='${SUPA_URL}', SKEY='${SUPA_KEY}'
const CH1='${CH1}', CH2='${CH2}'
const T1='${t1}', T2='${t2}'
const fmt = n => Number(n||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})

let cfg = {}
let stA = {status:'idle',items:[],subtotal:0,discount:0,total:0}
let stB = {status:'idle',items:[],subtotal:0,discount:0,total:0}
let _slideTimer = null, _slideIdx = 0, _vidIdx = 0
let _timerA = null, _timerB = null

const sb = window.supabase.createClient(SURL, SKEY, {db:{schema:'pos'}})

async function loadCfg() {
  const {data} = await sb.from('settings').select('key,value')
  if (data) cfg = Object.fromEntries(data.map(r=>[r.key,r.value]))
  renderMedia()
  renderPos('p1', stA, T1)
  renderPos('p2', stB, T2)
}

/* ── MEDIA CENTER ── */
function renderMedia() {
  const el = document.getElementById('med')
  const vids = [cfg.display_video_1,cfg.display_video_2,cfg.display_video_3,cfg.display_video_4,cfg.display_video_5].filter(Boolean)
  const imgs = [cfg.display_image_1,cfg.display_image_2,cfg.display_image_3].filter(Boolean)

  if (_slideTimer) { clearInterval(_slideTimer); _slideTimer = null }

  if (vids.length > 0) {
    el.innerHTML = '<video id="vid" muted autoplay playsinline style="width:100%;height:100%;object-fit:cover"></video>'
      + '<div class="med-mute" id="muteBtn" onclick="toggleMute()">🔇</div>'
    setupVid(vids)
  } else if (imgs.length > 0) {
    const slides = imgs.map((u,i)=>'<div class="slide'+(i===0?' on':'')+'">'
      +'<img src="'+u+'"></div>').join('')
    el.innerHTML = '<div class="slides">'+slides+'</div>'
    _slideIdx = 0
    _slideTimer = setInterval(() => {
      _slideIdx = (_slideIdx+1) % imgs.length
      el.querySelectorAll('.slide').forEach((s,i)=>s.classList.toggle('on',i===_slideIdx))
    }, 5000)
  } else {
    const logoHtml = cfg.shop_logo
      ? '<div class="logo-wrap"><img src="'+cfg.shop_logo+'"></div>'
      : '<div style="font-size:72px">🏪</div>'
    el.innerHTML = '<div class="no-media">'+logoHtml+'<div class="wlc">ยินดีต้อนรับ</div></div>'
  }
}

function setupVid(vids) {
  const v = document.getElementById('vid')
  if (!v) return
  _vidIdx = 0; v.src = vids[0]
  v.onended = () => { _vidIdx = (_vidIdx+1)%vids.length; v.src = vids[_vidIdx]; v.play().catch(()=>{}) }
  v.play().catch(()=>{})
}

function toggleMute() {
  const v = document.getElementById('vid')
  const b = document.getElementById('muteBtn')
  if (!v) return
  v.muted = !v.muted
  if (b) b.textContent = v.muted ? '🔇' : '🔊'
}

/* ── POS PANEL ── */
function logoSmall() {
  if (cfg.shop_logo) return '<div class="logo-wrap"><img src="'+cfg.shop_logo+'"></div>'
  return '<div style="font-size:48px">🏪</div>'
}

function renderPos(id, st, tid) {
  const el = document.getElementById(id)
  const isIdle = st.status === 'idle'
  el.className = 'pos' + (isIdle ? ' idle-dim' : '')

  if (isIdle) {
    el.innerHTML = '<div class="pos-idle">'+logoSmall()
      +'<div class="wlc">ยินดีต้อนรับ</div>'
      +'<div class="tid">'+tid+'</div></div>'
    return
  }

  if (st.status === 'active') {
    const rows = (st.items||[]).map(i=>
      '<div class="ci"><div><div class="ci-name">'+i.name+'</div>'
      +'<div class="ci-unit">฿'+fmt(i.price)+' × '+i.qty+'</div></div>'
      +'<div class="ci-tot">฿'+fmt(i.subtotal)+'</div></div>'
    ).join('')
    const disc = st.discount>0 ? '<div class="disc">ส่วนลด −฿'+fmt(st.discount)+'</div>' : ''
    el.innerHTML = '<div class="pos-active">'
      +'<div class="pos-hdr"><h2>รายการสินค้า</h2></div>'
      +'<div class="pos-body">'+rows+'</div>'
      +'<div class="pos-total"><div class="lbl">ยอดชำระ</div>'
      +'<div class="amt">฿'+fmt(st.total)+'</div>'+disc+'</div></div>'
    return
  }

  if (st.status === 'paying') {
    el.innerHTML = '<div class="pos-paying">'
      +'<div class="ic">💳</div><div class="t1">กำลังชำระเงิน</div>'
      +'<div class="t2">฿'+fmt(st.total)+'</div></div>'
    return
  }

  if (st.status === 'paying_qr') {
    const qrEl = cfg.payment_qr
      ? '<img src="'+cfg.payment_qr+'" alt="QR">'
      : '<div style="font-size:72px">📱</div>'
    el.innerHTML = '<div class="pos-qr">'
      +'<div class="qt">สแกนเพื่อชำระเงิน</div>'
      +qrEl
      +'<div class="qa">฿'+fmt(st.total)+'</div></div>'
    return
  }

  if (st.status === 'paid') {
    el.innerHTML = '<div class="pos-paid">'
      +'<div class="ic">🧾</div>'
      +'<div class="p1">กรุณา</div>'
      +'<div class="p2">รับใบเสร็จ</div>'
      +'<div class="p3">จากพนักงาน</div>'
      +'<div class="p4">ขอบคุณที่ใช้บริการ 🙏</div></div>'
    return
  }
}

loadCfg()

sb.channel(CH1).on('broadcast',{event:'pos'},({payload})=>{
  if (_timerA) { clearTimeout(_timerA); _timerA = null }
  stA = payload
  renderPos('p1', stA, T1)
  if (payload.status === 'paid') {
    _timerA = setTimeout(() => {
      stA = {status:'idle',items:[],subtotal:0,discount:0,total:0}
      renderPos('p1', stA, T1); _timerA = null
    }, 7000)
  }
}).subscribe()

sb.channel(CH2).on('broadcast',{event:'pos'},({payload})=>{
  if (_timerB) { clearTimeout(_timerB); _timerB = null }
  stB = payload
  renderPos('p2', stB, T2)
  if (payload.status === 'paid') {
    _timerB = setTimeout(() => {
      stB = {status:'idle',items:[],subtotal:0,discount:0,total:0}
      renderPos('p2', stB, T2); _timerB = null
    }, 7000)
  }
}).subscribe()
</script>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
