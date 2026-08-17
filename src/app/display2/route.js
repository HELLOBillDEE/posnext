export const dynamic = 'force-dynamic'

export function GET(request) {
  const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const url = new URL(request.url)
  const t1 = (url.searchParams.get('t1') || 'pos1').toLowerCase()
  const t2 = (url.searchParams.get('t2') || 'pos2').toLowerCase()
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
#med-bg{position:absolute;inset:0;transition:opacity 0.8s;}
#med-bg video{width:100%;height:100%;object-fit:cover;}
.slides{width:100%;height:100%;position:relative;}
.slide{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 1.2s;}
.slide.on{opacity:1;}
.slide img{width:100%;height:100%;object-fit:cover;}
.no-media{width:100%;height:100%;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;}
.no-media .logo-wrap img{max-width:140px;max-height:140px;object-fit:contain;}
.no-media .wlc{font-size:22px;color:rgba(255,255,255,0.7);}
.med-mute{position:absolute;bottom:12px;right:12px;background:rgba(0,0,0,0.5);color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;user-select:none;z-index:20;}

/* ── PROMO PANEL ── */
#med-promo{position:absolute;inset:0;opacity:0;transition:opacity 0.8s;pointer-events:none;
  background:linear-gradient(160deg,#0f172a 0%,#1e1035 40%,#2d1b4e 100%);
  display:flex;flex-direction:column;padding:14px 12px 10px;}
#med-promo.on{opacity:1;}
.promo-hdr{flex-shrink:0;text-align:center;margin-bottom:10px;}
.promo-hdr-top{font-size:13px;color:rgba(255,255,255,0.5);letter-spacing:2px;text-transform:uppercase;margin-bottom:2px;}
.promo-hdr-title{font-size:22px;font-weight:800;line-height:1.1;}
.promo-hdr-title .hl{color:#fbbf24;}
.promo-hdr-sub{font-size:12px;color:rgba(255,255,255,0.4);margin-top:3px;}
.promo-divider{height:2px;background:linear-gradient(90deg,transparent,#C72C41,#fbbf24,#C72C41,transparent);margin-bottom:10px;flex-shrink:0;}
.promo-grid{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:7px;overflow:hidden;}
.promo-card{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;
  padding:10px 10px 8px;display:flex;flex-direction:column;justify-content:space-between;
  position:relative;overflow:hidden;}
.promo-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#C72C41,#fbbf24);}
.promo-card-cat{font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;}
.promo-card-name{font-size:13px;color:#f1f5f9;font-weight:600;line-height:1.35;flex:1;}
.promo-card-bottom{margin-top:8px;display:flex;align-items:flex-end;justify-content:space-between;}
.promo-card-price{font-size:26px;font-weight:800;color:#fbbf24;line-height:1;}
.promo-card-price small{font-size:13px;font-weight:500;color:rgba(255,255,255,0.4);}
.promo-card-unit{font-size:11px;color:rgba(255,255,255,0.35);text-align:right;}
.promo-footer{flex-shrink:0;display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);}
.promo-footer-shop{font-size:11px;color:rgba(255,255,255,0.3);}
.promo-footer-page{display:flex;gap:4px;}
.promo-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.2);}
.promo-dot.on{background:#fbbf24;}

/* ── PROMO BG-IMAGE MODE ── */
#med-promo.has-bg{background:var(--slot-bg,#000) center/cover no-repeat!important;}
.promo-bg-fade{position:absolute;inset:0;
  background:linear-gradient(to top,rgba(4,7,18,0.97) 0%,rgba(4,7,18,0.72) 38%,rgba(4,7,18,0.1) 65%,transparent 100%);
  pointer-events:none;}
.promo-overlay{position:absolute;bottom:0;left:0;right:0;padding:6px 8px 8px;display:flex;flex-direction:column;gap:5px;}
.promo-overlay-cat{text-align:center;font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;
  color:rgba(251,146,60,0.75);padding-bottom:2px;}
.promo-overlay .promo-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;}
.promo-overlay .promo-card{
  background:rgba(4,8,20,0.84);
  backdrop-filter:blur(10px);
  border:1px solid rgba(251,146,60,0.18);
  border-top:2px solid rgba(251,146,60,0.65);}
.promo-overlay .promo-card-cat{color:rgba(251,146,60,0.55);}
.promo-overlay .promo-card-price{color:#fb923c;}
.promo-overlay .promo-card-price small{color:rgba(255,255,255,0.35);}
.promo-overlay .promo-footer{margin:0;padding-top:4px;border-color:rgba(251,146,60,0.12);}
.promo-overlay .promo-footer-shop{color:rgba(251,146,60,0.4);}
.promo-overlay .promo-dot{background:rgba(251,146,60,0.2);}
.promo-overlay .promo-dot.on{background:#fb923c;}

/* ── POS PANEL BASE ── */
.pos{display:flex;flex-direction:column;overflow:hidden;transition:opacity .4s;}
.pos.idle-dim{opacity:.55;}
.pos-idle{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;background:#fff;position:relative;}
.pos-idle .logo-wrap img{max-width:100%;max-height:140px;object-fit:contain;}
.pos-idle .wlc{font-size:18px;color:#94a3b8;text-align:center;}
.pos-idle .tid{font-size:11px;color:#cbd5e1;margin-top:4px;}
.d2-clock-wrap{position:absolute;bottom:14px;left:0;right:0;text-align:center;}
.d2-clock-time{font-size:34px;font-weight:800;color:#1e293b;letter-spacing:2px;font-variant-numeric:tabular-nums;}
.d2-clock-date{font-size:11px;color:#64748b;margin-top:2px;}
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
.pos-paying{flex:1;background:linear-gradient(135deg,#0f172a,#1e293b);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#fff;}
.pos-paying .ic{font-size:52px;}
.pos-paying .t1{font-size:18px;opacity:.75;}
.pos-paying .t2{font-size:46px;font-weight:800;}
.pos-qr{flex:1;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;}
.pos-qr .qt{font-size:14px;color:#64748b;}
.pos-qr img{width:min(200px,80%);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.1);}
.pos-qr .qa{font-size:20px;font-weight:800;color:#0369a1;}
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
  <div id="med" class="med">
    <div id="med-bg"></div>
    <div id="med-promo"></div>
    <div class="med-mute" id="muteBtn" onclick="toggleMute()" style="display:none">🔇</div>
  </div>
  <div id="p2" class="pos"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script>
const SURL='${SUPA_URL}', SKEY='${SUPA_KEY}'
const CH1='${CH1}', CH2='${CH2}'
const T1='${t1}', T2='${t2}'
const fmtPrice = n => Number(n||0).toLocaleString('th-TH',{minimumFractionDigits:0,maximumFractionDigits:0})
const fmt = n => Number(n||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})

let cfg = {}
let stA = {status:'idle',items:[],subtotal:0,discount:0,total:0}
let stB = {status:'idle',items:[],subtotal:0,discount:0,total:0}
let _slideTimer = null, _slideIdx = 0, _ytTimer2 = null, _ytMuted2 = true, _ytBaseSrc2 = ''
let _timerA = null, _timerB = null
let _promos = [], _promoPage = 0, _cycleTimer = null, _showPromo = false

function isYT(u){return!!u&&(u.includes('youtube.com')||u.includes('youtu.be'))}
function isPlaylist(u){try{const p=new URL(u);return isYT(u)&&p.pathname==='/playlist'&&!!p.searchParams.get('list')}catch{return false}}
function playlistId(u){try{return new URL(u).searchParams.get('list')||''}catch{return ''}}
function ytId(u){try{const p=new URL(u);if(p.hostname==='youtu.be')return p.pathname.slice(1).split('?')[0];if(p.pathname.startsWith('/shorts/'))return p.pathname.split('/')[2]||'';return p.searchParams.get('v')||''}catch{return ''}}
function ytSrc2(base){return base+(_ytMuted2?'&mute=1':'')}
const ITEMS_PER_PAGE = 8
const CYCLE_SEC = 12000

const sb = window.supabase.createClient(SURL, SKEY, {db:{schema:'pos'}})

async function loadCfg() {
  const {data} = await sb.from('settings').select('key,value')
  if (data) cfg = Object.fromEntries(data.map(r=>[r.key,r.value]))
  await loadPromos()
  renderMedia()
  renderPos('p1', stA, T1)
  renderPos('p2', stB, T2)
}

/* ── PROMO DATA ── */
async function loadPromos() {
  try {
    // ดึงสินค้าที่ tag 'โปร' ใน search_tags
    let { data } = await sb.from('products')
      .select('id,name,price,unit,categories(name),search_tags')
      .ilike('search_tags','%โปร%')
      .gt('price',0)
      .order('name')
      .limit(40)
    if (!data || data.length === 0) {
      // fallback: ดึงสินค้า 16 รายการล่าสุด
      const res = await sb.from('products')
        .select('id,name,price,unit,categories(name)')
        .gt('price',0)
        .order('id',{ascending:false})
        .limit(16)
      data = res.data || []
    }
    _promos = data
  } catch(e) { console.error('loadPromos',e) }
}

function buildPromoSlots() {
  const slots = []
  for (let i = 1; i <= 3; i++) {
    const img = cfg['promo_template_'+i+'_image']
    if (!img) continue
    const catDisplay = (cfg['promo_template_'+i+'_cat'] || '').trim()
    const cat = catDisplay.toLowerCase()
    const items = cat
      ? _promos.filter(p => (p.categories?.name||'').toLowerCase().includes(cat))
      : _promos
    slots.push({ img, catDisplay, items: items.length ? items : _promos })
  }
  return slots
}

function renderPromoSlide() {
  const el = document.getElementById('med-promo')
  if (!el || !_promos.length) return

  const slots = buildPromoSlots()

  let bgImage = '', items = _promos
  if (slots.length > 0) {
    const slot = slots[_promoPage % slots.length]
    bgImage = slot.img
    items = slot.items
  }

  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE)
  const page = slots.length > 0 ? 0 : (_promoPage % totalPages)
  const pageItems = items.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE)

  const cards = pageItems.map(p => {
    const cat = p.categories?.name || ''
    return '<div class="promo-card">'
      + (cat ? '<div class="promo-card-cat">'+cat+'</div>' : '')
      + '<div class="promo-card-name">'+p.name+'</div>'
      + '<div class="promo-card-bottom">'
      + '<div class="promo-card-price">฿'+fmtPrice(p.price)+'<small>/'+( p.unit||'ชิ้น')+'</small></div>'
      + '</div></div>'
  }).join('')

  const dots = slots.length > 1
    ? Array.from({length:slots.length},(_,i)=>'<div class="promo-dot'+(i===(_promoPage%slots.length)?' on':'')+'"></div>').join('')
    : totalPages > 1
      ? Array.from({length:totalPages},(_,i)=>'<div class="promo-dot'+(i===page?' on':'')+'"></div>').join('')
      : ''

  const footer = '<div class="promo-footer">'
    + '<div class="promo-footer-shop">'+(cfg.shop_name||'ราคารวม VAT แล้ว')+'</div>'
    + '<div class="promo-footer-page">'+dots+'</div>'
    + '</div>'

  if (bgImage) {
    el.style.setProperty('--slot-bg', 'url('+bgImage+')')
    el.classList.add('has-bg')
    const catLabel = slots.length > 0 ? (slots[_promoPage % slots.length].catDisplay || '') : ''
    el.innerHTML = '<div class="promo-bg-fade"></div>'
      + '<div class="promo-overlay">'
      + (catLabel ? '<div class="promo-overlay-cat">★ ราคา'+catLabel+' ★</div>' : '')
      + '<div class="promo-grid">'+cards+'</div>'
      + footer
      + '</div>'
  } else {
    el.style.removeProperty('--slot-bg')
    el.classList.remove('has-bg')
    el.innerHTML = '<div class="promo-hdr">'
      + '<div class="promo-hdr-top">★ ราคาพิเศษ ★</div>'
      + '<div class="promo-hdr-title">🔥 โปรโมชั่น <span class="hl">วันนี้</span></div>'
      + '<div class="promo-hdr-sub">'+(cfg.shop_name||'')+'</div>'
      + '</div>'
      + '<div class="promo-divider"></div>'
      + '<div class="promo-grid">'+cards+'</div>'
      + footer
  }
}

/* ── MEDIA CENTER ── */
function renderMedia() {
  const bg = document.getElementById('med-bg')
  const allUrls = [cfg.display_video_1,cfg.display_video_2,cfg.display_video_3,cfg.display_video_4,cfg.display_video_5].filter(Boolean)
  const items = allUrls.map(u=>({url:u,yt:isYT(u),id:ytId(u),playlist:isPlaylist(u),listId:playlistId(u)}))
  const imgs = [cfg.display_image_1,cfg.display_image_2,cfg.display_image_3].filter(Boolean)

  if (_slideTimer) { clearInterval(_slideTimer); _slideTimer = null }
  if (_cycleTimer) { clearInterval(_cycleTimer); _cycleTimer = null }

  if (items.length > 0) {
    const muteBtn = document.getElementById('muteBtn')
    bg.innerHTML = '<video id="vid" muted autoplay playsinline style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;display:none"></video>'
      + '<iframe id="ytFrame2" style="width:100%;height:100%;border:none;position:absolute;inset:0;display:none" allow="autoplay;encrypted-media" allowfullscreen></iframe>'
    if (muteBtn) muteBtn.style.display = 'none'
    setupVid(items, muteBtn)
  } else if (imgs.length > 0) {
    const slides = imgs.map((u,i)=>'<div class="slide'+(i===0?' on':'')+'">'
      +'<img src="'+u+'"></div>').join('')
    bg.innerHTML = '<div class="slides">'+slides+'</div>'
    _slideIdx = 0
    _slideTimer = setInterval(() => {
      _slideIdx = (_slideIdx+1) % imgs.length
      bg.querySelectorAll('.slide').forEach((s,i)=>s.classList.toggle('on',i===_slideIdx))
    }, 5000)
  } else {
    const logoHtml = cfg.shop_logo
      ? '<div class="logo-wrap"><img src="'+cfg.shop_logo+'"></div>'
      : '<div style="font-size:72px">🏪</div>'
    bg.innerHTML = '<div class="no-media">'+logoHtml+'<div class="wlc">ยินดีต้อนรับ</div></div>'
  }

  // promo cycling ปิดแล้ว — ไม่ startCycle()
}

function startCycle() {
  _showPromo = false
  _cycleTimer = setInterval(() => {
    _showPromo = !_showPromo
    const bg   = document.getElementById('med-bg')
    const promo = document.getElementById('med-promo')
    if (_showPromo) {
      renderPromoSlide()
      if (bg)    bg.style.opacity = '0'
      if (promo) promo.classList.add('on')
      _promoPage++
    } else {
      if (bg)    bg.style.opacity = '1'
      if (promo) promo.classList.remove('on')
    }
  }, CYCLE_SEC)
}

function setupVid(items, muteBtn) {
  const v = document.getElementById('vid')
  const f = document.getElementById('ytFrame2')
  if (!items.length) return
  const ytItems = items.filter(i=>i.yt), dirItems = items.filter(i=>!i.yt)
  function showBtn(show){ if(muteBtn){muteBtn.style.display=show?'flex':'none';muteBtn.textContent=_ytMuted2?'🔇':'🔊'} }
  // Playlist URL
  const plItem=items.find(i=>i.playlist)
  if(plItem){
    if(v)v.style.display='none'
    if(f){
      _ytBaseSrc2='https://www.youtube.com/embed?listType=playlist&list='+plItem.listId+'&autoplay=1&loop=1&controls=0&rel=0&modestbranding=1'
      f.src=ytSrc2(_ytBaseSrc2);f.style.display='block'
    }
    showBtn(true);return
  }
  if (ytItems.length && !dirItems.length) {
    if (v) v.style.display = 'none'
    if (f) {
      const ids = ytItems.map(i=>i.id).filter(Boolean)
      _ytBaseSrc2='https://www.youtube.com/embed/'+ids[0]+'?autoplay=1&loop=1&playlist='+ids.join(',')+'&controls=0&rel=0&modestbranding=1'
      f.src = ytSrc2(_ytBaseSrc2); f.style.display = 'block'
    }
    showBtn(true); return
  }
  let idx = 0
  function show(i) {
    const it = items[i]
    if (it.yt) {
      if (v) { v.pause(); v.style.display = 'none' }
      if (f) {
        _ytBaseSrc2='https://www.youtube.com/embed/'+it.id+'?autoplay=1&controls=0&rel=0&modestbranding=1'
        f.src = ytSrc2(_ytBaseSrc2); f.style.display = 'block'
        if (_ytTimer2) clearTimeout(_ytTimer2)
        _ytTimer2 = setTimeout(()=>{ idx=(idx+1)%items.length; show(idx) }, 60000)
      }
      showBtn(true)
    } else {
      if (f) { f.src = 'about:blank'; f.style.display = 'none'; _ytBaseSrc2='' }
      if (_ytTimer2) { clearTimeout(_ytTimer2); _ytTimer2 = null }
      if (v) {
        v.style.display = 'block'; v.src = it.url
        v.onended = () => { idx=(idx+1)%items.length; show(idx) }
        v.play().catch(()=>{})
      }
      showBtn(true)
    }
  }
  show(0)
}

function toggleMute() {
  const v = document.getElementById('vid')
  const f = document.getElementById('ytFrame2')
  const b = document.getElementById('muteBtn')
  _ytMuted2 = !_ytMuted2
  if (b) b.textContent = _ytMuted2 ? '🔇' : '🔊'
  if (f && f.style.display !== 'none' && _ytBaseSrc2) f.src = ytSrc2(_ytBaseSrc2)
  if (v && v.style.display !== 'none') v.muted = _ytMuted2
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
      +'<div class="tid">'+tid+'</div>'
      +'<div class="d2-clock-wrap"><div class="d2-clock-time">--:--:--</div><div class="d2-clock-date"></div></div>'
      +'</div>'
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
    const rows = (st.items||[]).map(i=>
      '<div class="ci"><div><div class="ci-name">'+i.name+'</div>'
      +'<div class="ci-unit">฿'+fmt(i.price)+' × '+i.qty+'</div></div>'
      +'<div class="ci-tot">฿'+fmt(i.subtotal)+'</div></div>'
    ).join('')
    const mixRows = (st.pay_mix&&st.pay_mix.length>1)
      ? '<div style="margin:6px 0;display:flex;flex-direction:column;gap:4px;width:100%">'
        +st.pay_mix.map(m=>'<div style="display:flex;justify-content:space-between;font-size:12px;opacity:.85;border-bottom:1px solid rgba(255,255,255,.15);padding-bottom:4px"><span>'+m.label+'</span><span style="font-weight:700">฿'+fmt(m.amount)+'</span></div>').join('')
        +'</div>'
      : ''
    el.innerHTML = '<div class="pos-active">'
      +'<div class="pos-hdr" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">'
      +'<h2>💳 กำลังชำระเงิน</h2></div>'
      +'<div class="pos-body">'+rows+'</div>'
      +'<div class="pos-total" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">'
      +'<div class="lbl">ยอดชำระ</div><div class="amt">฿'+fmt(st.total)+'</div>'+mixRows+'</div></div>'
    return
  }
  if (st.status === 'paying_qr') {
    const qrSrc = st.qr_url || cfg.payment_qr || ''
    const qrEl = qrSrc ? '<img src="'+qrSrc+'" alt="QR" style="width:min(130px,70%);border-radius:8px">' : '<div style="font-size:48px">📱</div>'
    const rows = (st.items||[]).map(i=>
      '<div class="ci"><div><div class="ci-name">'+i.name+'</div>'
      +'<div class="ci-unit">฿'+fmt(i.price)+' × '+i.qty+'</div></div>'
      +'<div class="ci-tot">฿'+fmt(i.subtotal)+'</div></div>'
    ).join('')
    const qrAmt = (st.pay_mix||[]).find(m=>m.label==='โอน/QR')?.amount ?? st.total
    const otherMix = (st.pay_mix||[]).filter(m=>m.label!=='โอน/QR')
    const otherRows = otherMix.length>0
      ? '<div style="margin-top:6px;width:100%;display:flex;flex-direction:column;gap:3px">'
        +otherMix.map(m=>'<div style="display:flex;justify-content:space-between;font-size:11px;background:#f1f5f9;border-radius:6px;padding:4px 8px"><span>'+m.label+'</span><span style="font-weight:700;color:#0f172a">฿'+fmt(m.amount)+'</span></div>').join('')
        +'</div>'
      : ''
    el.innerHTML = '<div class="pos-active">'
      +'<div class="pos-hdr"><h2>รายการสินค้า</h2></div>'
      +'<div class="pos-body">'+rows+'</div>'
      +'<div class="pos-qr" style="flex:0 0 auto;padding:12px 8px;border-top:1px solid #e2e8f0">'
      +'<div class="qt">สแกนเพื่อชำระเงิน</div>'
      +qrEl+'<div class="qa">฿'+fmt(qrAmt)+'</div>'+otherRows+'</div></div>'
    return
  }
  if (st.status === 'paid') {
    el.innerHTML = '<div class="pos-paid">'
      +'<div class="ic">🧾</div><div class="p1">กรุณา</div>'
      +'<div class="p2">รับใบเสร็จ</div><div class="p3">จากพนักงาน</div>'
      +'<div class="p4">ขอบคุณที่ใช้บริการ 🙏</div></div>'
    return
  }
}

/* ── INIT ── */
loadCfg()

// Clock for idle panels
function d2ClockTick(){
  const now=new Date()
  const t=now.toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})
  const d=now.toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',weekday:'long',day:'numeric',month:'long',year:'numeric'})
  document.querySelectorAll('.d2-clock-time').forEach(el=>el.textContent=t)
  document.querySelectorAll('.d2-clock-date').forEach(el=>el.textContent=d)
}
d2ClockTick()
setInterval(d2ClockTick,1000)

// รีเฟรชราคาสินค้าทุก 5 นาที
setInterval(async () => {
  await loadPromos()
  if (_showPromo) renderPromoSlide()
}, 5 * 60 * 1000)

// Realtime: อัพเดทเมื่อสินค้าเปลี่ยน
sb.channel('promo-products')
  .on('postgres_changes',{event:'*',schema:'pos',table:'products'}, async () => {
    await loadPromos()
    if (_showPromo) renderPromoSlide()
  })
  .subscribe()

sb.channel(CH1).on('broadcast',{event:'pos'},({payload})=>{
  if (_timerA) { clearTimeout(_timerA); _timerA = null }
  stA = payload; renderPos('p1', stA, T1)
  if (payload.status === 'paid') {
    _timerA = setTimeout(() => {
      stA = {status:'idle',items:[],subtotal:0,discount:0,total:0}
      renderPos('p1', stA, T1); _timerA = null
    }, 7000)
  }
}).subscribe()

sb.channel(CH2).on('broadcast',{event:'pos'},({payload})=>{
  if (_timerB) { clearTimeout(_timerB); _timerB = null }
  stB = payload; renderPos('p2', stB, T2)
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
