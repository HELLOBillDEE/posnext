export const dynamic = 'force-dynamic'

export function GET(request) {
  const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const sp = new URL(request.url).searchParams
  const terminalId = (sp.get('t') || sp.get('T') || '').toLowerCase()
  const CHANNEL = terminalId ? 'customer-display-' + terminalId : 'customer-display'

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Customer Display</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:100%;height:100%;overflow:hidden;background:#111;}
body{font-family:'Kanit',sans-serif;}
#app{width:100vw;height:100vh;position:fixed;inset:0;}

/* split */
.split{display:flex;width:100%;height:100%;}
.pL{width:50%;height:100%;overflow:hidden;position:relative;}
.pR{width:50%;height:100%;overflow:hidden;position:relative;display:flex;flex-direction:column;}

/* fullscreen overlay */
.fs{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}

/* ── IDLE ── */
.slides{width:100%;height:100%;position:relative;background:linear-gradient(135deg,#1a1a2e,#16213e);}
.slide{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;opacity:0;transition:opacity 1.2s ease;}
.slide.on{opacity:1;}
.s1{color:#fff;}
.s1 .logo{width:130px;height:130px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,0.25);margin-bottom:20px;display:flex;align-items:center;justify-content:center;}
.s1 .logo img{width:100%;height:100%;object-fit:cover;}
.s1 .sname{font-size:36px;font-weight:700;text-align:center;}
.s1 .sub{font-size:18px;opacity:.6;margin-top:6px;}
.s2{color:#fff;background:linear-gradient(135deg,#C72C41,#801336);}
.s2 .ic{font-size:64px;margin-bottom:12px;}
.s2 .tx1{font-size:22px;opacity:.85;}
.s2 .tx2{font-size:48px;font-weight:700;margin-top:4px;text-align:center;}
.s3{color:#fff;}
.s3 .ic{font-size:60px;margin-bottom:12px;}
.s3 .tx1{font-size:22px;opacity:.75;text-align:center;}
.s3 .tx2{font-size:34px;font-weight:600;margin-top:6px;text-align:center;}

.idle-r{background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px;}
.idle-r .logo{width:150px;height:150px;border-radius:50%;overflow:hidden;border:4px solid #f1f5f9;}
.idle-r .logo img{width:100%;height:100%;object-fit:cover;}
.idle-r .sname{font-size:26px;font-weight:700;color:#1e293b;text-align:center;}
.idle-r .phone{font-size:22px;color:#C72C41;font-weight:600;}
.idle-r .wlc{font-size:16px;color:#94a3b8;margin-top:4px;}
#clock-wrap{position:absolute;bottom:16px;left:0;right:0;text-align:center;}
#clock-time{font-size:44px;font-weight:800;color:#1e293b;letter-spacing:2px;line-height:1;font-variant-numeric:tabular-nums;}
#clock-date{font-size:13px;color:#64748b;margin-top:2px;}

/* ── ACTIVE ── */
.cart-l{background:#f8fafc;display:flex;flex-direction:column;}
.cart-hdr{background:linear-gradient(135deg,#C72C41,#801336);color:#fff;padding:14px 20px;flex-shrink:0;}
.cart-hdr h2{font-size:20px;font-weight:700;}
.cart-body{flex:1;overflow-y:auto;padding:10px;}
.cart-body::-webkit-scrollbar{display:none;}
.ci{display:flex;justify-content:space-between;align-items:center;background:#fff;border-radius:10px;padding:12px 14px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.07);}
.ci-name{font-size:17px;font-weight:600;color:#1e293b;}
.ci-unit{font-size:13px;color:#94a3b8;margin-top:2px;}
.ci-tot{font-size:20px;font-weight:700;color:#C72C41;flex-shrink:0;}

.total-r{background:linear-gradient(170deg,#C72C41,#801336);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;gap:6px;}
.total-r .lbl{font-size:18px;opacity:.8;}
.total-r .amt{font-size:58px;font-weight:800;line-height:1;}
.total-r .disc{font-size:15px;opacity:.7;}
.total-r .cnt{font-size:16px;opacity:.75;margin-top:6px;}

/* ── PAYING (cash/credit) ── */
.pay-fs{background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;}
.pay-fs .ic{font-size:72px;margin-bottom:20px;}
.pay-fs .t1{font-size:32px;opacity:.8;}
.pay-fs .t2{font-size:76px;font-weight:800;margin-top:8px;}

/* ── QR PAYMENT ── */
.qr-l{background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;}
.qr-l .qtitle{font-size:20px;color:#64748b;font-weight:500;}
.qr-l .qimg{width:min(260px,80%);border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.1);}
.qr-l .qnote{font-size:14px;color:#94a3b8;text-align:center;}
.qr-r{background:linear-gradient(135deg,#0369a1,#075985);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;gap:10px;}
.qr-r .ic{font-size:56px;}
.qr-r .t1{font-size:22px;opacity:.85;}
.qr-r .t2{font-size:64px;font-weight:800;line-height:1;}
.qr-r .t3{font-size:16px;opacity:.65;text-align:center;margin-top:4px;}

/* ── PAID ── */
.paid-fs{background:linear-gradient(135deg,#f0f9ff,#e0f2fe);}
.paid-card{background:#fff;border-radius:24px;padding:44px 60px;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.12);display:flex;flex-direction:column;align-items:center;gap:6px;max-width:580px;}
.paid-card .ic{font-size:72px;margin-bottom:4px;}
.paid-card .p1{font-size:28px;color:#C72C41;font-weight:700;}
.paid-card .p2{font-size:54px;font-weight:800;color:#0f172a;line-height:1.1;}
.paid-card .p3{font-size:40px;font-weight:700;color:#0f172a;}
.paid-card .p4{font-size:18px;color:#64748b;margin-top:8px;}
</style>
</head>
<body>
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script>
const SURL='${SUPA_URL}', SKEY='${SUPA_KEY}', CHANNEL='${CHANNEL}'
const fmt = n => Number(n||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})

let cfg={shop_name:'',shop_logo:'',shop_phone:'',payment_qr:'',display_video_1:'',display_video_2:'',display_video_3:'',display_video_4:'',display_video_5:'',display_image_1:'',display_image_2:'',display_image_3:''}
let state={status:'idle',items:[],subtotal:0,discount:0,total:0}
let slideIdx=0, slideTimer=null
let _ytTimer=null, _ytMuted=true, _ytBaseSrc=''

function isYT(u){return!!u&&(u.includes('youtube.com')||u.includes('youtu.be'))}
function isPlaylist(u){try{const p=new URL(u);return isYT(u)&&p.pathname==='/playlist'&&!!p.searchParams.get('list')}catch{return false}}
function playlistId(u){try{return new URL(u).searchParams.get('list')||''}catch{return ''}}
function ytId(u){try{const p=new URL(u);if(p.hostname==='youtu.be')return p.pathname.slice(1).split('?')[0];if(p.pathname.startsWith('/shorts/'))return p.pathname.split('/')[2]||'';return p.searchParams.get('v')||''}catch{return ''}}
function ytSrc(baseSrc){return baseSrc+(_ytMuted?'&mute=1':'')}

const app=document.getElementById('app')
const sb=window.supabase.createClient(SURL,SKEY,{db:{schema:'pos'}})

async function loadCfg(){
  const {data}=await sb.from('settings').select('key,value')
  if(data) cfg=Object.fromEntries(data.map(r=>[r.key,r.value]))
  render()
}

function logoEl(size){
  const s=size||'130px'
  if(cfg.shop_logo) return '<img src="'+cfg.shop_logo+'" style="width:'+s+';height:'+s+';border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.2)">'
  return '<div style="width:'+s+';height:'+s+';border-radius:50%;background:linear-gradient(135deg,#C72C41,#801336);display:flex;align-items:center;justify-content:center;font-size:calc('+s+' * 0.45);color:#fff">🔧</div>'
}
function logoElWhite(size){
  const s=size||'140px'
  if(cfg.shop_logo) return '<img src="'+cfg.shop_logo+'" style="max-width:90%;max-height:200px;width:auto;height:auto;object-fit:contain;">'
  return '<div style="width:'+s+';height:'+s+';border-radius:50%;background:linear-gradient(135deg,#C72C41,#801336);display:flex;align-items:center;justify-content:center;font-size:calc('+s+' * 0.45);color:#fff">🔧</div>'
}

function startSlides(n){
  if(slideTimer) clearInterval(slideTimer)
  slideIdx=0; updateSlide()
  slideTimer=setInterval(()=>{ slideIdx=(slideIdx+1)%(n||3); updateSlide() },5000)
}
function updateSlide(){
  document.querySelectorAll('.slide').forEach((el,i)=>el.classList.toggle('on',i===slideIdx))
}
function stopSlides(){
  if(slideTimer){clearInterval(slideTimer);slideTimer=null}
}
function setupPlaylist(items){
  const v=document.getElementById('vidPlayer')
  const f=document.getElementById('ytFrame')
  const btn=document.getElementById('muteBtn')
  if(!items.length)return
  const ytItems=items.filter(i=>i.yt), dirItems=items.filter(i=>!i.yt)
  function showMuteBtn(show){
    if(btn){btn.style.display=show?'flex':'none';btn.textContent=_ytMuted?'🔇':'🔊'}
  }
  // Playlist URL — embed ทั้ง playlist เลย (วางแค่ช่องเดียว)
  const plItem=items.find(i=>i.playlist)
  if(plItem){
    if(v)v.style.display='none'
    if(f){
      _ytBaseSrc='https://www.youtube.com/embed?listType=playlist&list='+plItem.listId+'&autoplay=1&controls=0&rel=0&modestbranding=1'
      f.src=ytSrc(_ytBaseSrc);f.style.display='block'
    }
    showMuteBtn(true);return
  }
  // All YouTube — use native YouTube playlist (YouTube handles cycling & looping)
  if(ytItems.length&&!dirItems.length){
    if(v)v.style.display='none'
    if(f){
      const ids=ytItems.map(i=>i.id).filter(Boolean)
      _ytBaseSrc='https://www.youtube.com/embed/'+ids[0]+'?autoplay=1&loop=1&playlist='+ids.join(',')+'&controls=0&rel=0&modestbranding=1'
      f.src=ytSrc(_ytBaseSrc); f.style.display='block'
    }
    showMuteBtn(true)
    return
  }
  // Mixed or all-direct: cycle items; timer for YT, onended for direct
  let idx=0
  function show(i){
    const it=items[i]
    if(it.yt){
      if(v){v.pause();v.style.display='none'}
      if(f){
        _ytBaseSrc='https://www.youtube.com/embed/'+it.id+'?autoplay=1&controls=0&rel=0&modestbranding=1'
        f.src=ytSrc(_ytBaseSrc); f.style.display='block'
        if(_ytTimer)clearTimeout(_ytTimer)
        _ytTimer=setTimeout(()=>{idx=(idx+1)%items.length;show(idx)},60000)
      }
      showMuteBtn(true)
    }else{
      if(f){f.src='about:blank';f.style.display='none';_ytBaseSrc=''}
      if(_ytTimer){clearTimeout(_ytTimer);_ytTimer=null}
      if(v){
        v.style.display='block';v.src=it.url
        v.onended=()=>{idx=(idx+1)%items.length;show(idx)}
        v.play().catch(()=>{})
      }
      showMuteBtn(true)
    }
  }
  show(0)
}

function render(){
  const s=state
  stopSlides()

  /* ── IDLE ── */
  if(s.status==='idle'){
    const allUrls=[cfg.display_video_1,cfg.display_video_2,cfg.display_video_3,cfg.display_video_4,cfg.display_video_5].filter(Boolean)
    const items=allUrls.map(u=>({url:u,yt:isYT(u),id:ytId(u),playlist:isPlaylist(u),listId:playlistId(u)}))
    const imgs=[cfg.display_image_1,cfg.display_image_2,cfg.display_image_3].filter(Boolean)
    let leftPanel='', slideCount=0, pendingItems=null
    if(items.length>0){
      leftPanel='<div class="pL" style="background:#000;position:relative"><video id="vidPlayer" muted autoplay playsinline style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;display:none"></video><iframe id="ytFrame" style="width:100%;height:100%;border:none;position:absolute;inset:0;display:none" allow="autoplay;encrypted-media" allowfullscreen></iframe><div id="muteBtn" onclick="toggleMute()" style="position:absolute;bottom:12px;right:12px;background:rgba(0,0,0,0.5);color:#fff;border-radius:50%;width:36px;height:36px;display:none;align-items:center;justify-content:center;font-size:18px;cursor:pointer;user-select:none" title="แตะเพื่อเปิด/ปิดเสียง">🔇</div></div>'
      pendingItems=items
    } else if(imgs.length>0){
      const imgSlides=imgs.map((u,i)=>'<div class="slide"'+(i===0?' style="opacity:1"':'')+'>'+
        '<img src="'+u+'" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0"></div>').join('')
      leftPanel='<div class="pL"><div class="slides">'+imgSlides+'</div></div>'
      slideCount=imgs.length
    } else {
      const phoneSlide=cfg.shop_phone
        ?'<div class="slide s2"><div class="ic">📞</div><div class="tx1">ติดต่อสอบถาม</div><div class="tx2">'+cfg.shop_phone+'</div></div>'
        :'<div class="slide s2"><div class="ic">🛍️</div><div class="tx1">มีสินค้ามากมาย</div><div class="tx2">ราคาถูก คุณภาพดี</div></div>'
      leftPanel='<div class="pL"><div class="slides">'+
        '<div class="slide s1">'+logoEl('130px')+'<div class="sname">'+(cfg.shop_name||'ยินดีต้อนรับ')+'</div><div class="sub">ขอบคุณที่ใช้บริการ</div></div>'+
        phoneSlide+
        '<div class="slide s3"><div class="ic">🛒</div><div class="tx1">เลือกสินค้าที่ต้องการ</div><div class="tx2">แจ้งพนักงานได้เลย</div></div>'+
        '</div></div>'
      slideCount=3
    }
    const tid=CHANNEL.replace('customer-display-','').replace('customer-display','')
    const rightPanel='<div class="pR idle-r" style="position:relative">'+logoElWhite('150px')+'<div style="margin-top:8px;padding:10px 16px;border:2px solid #C72C41;border-radius:14px;text-align:center;color:#C72C41;font-weight:700;font-size:15px;line-height:1.5">🧾 กรุณารับใบเสร็จ<br>จากพนักงานทุกครั้ง</div>'+'<div class="wlc" style="margin-top:4px">ยินดีต้อนรับ</div>'+(tid?'<div style="font-size:11px;color:#94a3b8;margin-top:6px">'+tid+'</div>':'')+'<div id="clock-wrap"><div id="clock-time">--:--:--</div><div id="clock-date"></div></div>'+'</div>'
    app.innerHTML='<div class="split">'+leftPanel+rightPanel+'</div>'
    if(pendingItems) setupPlaylist(pendingItems)
    else if(slideCount>0) startSlides(slideCount)
    return
  }

  /* ── ACTIVE ── */
  if(s.status==='active'){
    const rows=(s.items||[]).map(i=>
      '<div class="ci"><div><div class="ci-name">'+i.name+'</div><div class="ci-unit">฿'+fmt(i.price)+' × '+i.qty+'</div></div><div class="ci-tot">฿'+fmt(i.subtotal)+'</div></div>'
    ).join('')
    const disc=s.discount>0?'<div class="disc">ส่วนลด −฿'+fmt(s.discount)+'</div>':''
    app.innerHTML=\`
      <div class="split">
        <div class="pL cart-l">
          <div class="cart-hdr"><h2>รายการสินค้า</h2></div>
          <div class="cart-body">\${rows}</div>
        </div>
        <div class="pR total-r">
          <div class="lbl">ยอดชำระ</div>
          <div class="amt">฿\${fmt(s.total)}</div>
          \${disc}
          <div class="cnt">\${(s.items||[]).length} รายการ</div>
        </div>
      </div>
    \`
    return
  }

  /* ── PAYING (cash / credit) ── */
  if(s.status==='paying'){
    const rows=(s.items||[]).map(i=>
      '<div class="ci"><div><div class="ci-name">'+i.name+'</div><div class="ci-unit">฿'+fmt(i.price)+' × '+i.qty+'</div></div><div class="ci-tot">฿'+fmt(i.subtotal)+'</div></div>'
    ).join('')
    const disc=s.discount>0?'<div class="disc">ส่วนลด −฿'+fmt(s.discount)+'</div>':''
    app.innerHTML=\`
      <div class="split">
        <div class="pL cart-l">
          <div class="cart-hdr"><h2>รายการสินค้า</h2></div>
          <div class="cart-body">\${rows}</div>
        </div>
        <div class="pR total-r" style="background:linear-gradient(170deg,#0f172a,#1e3a5f)">
          <div class="lbl" style="font-size:20px">💳 กำลังชำระเงิน</div>
          <div class="amt">฿\${fmt(s.total)}</div>
          \${disc}
          <div class="cnt">\${(s.items||[]).length} รายการ</div>
        </div>
      </div>
    \`
    return
  }

  /* ── PAYING QR ── */
  if(s.status==='paying_qr'){
    const rows=(s.items||[]).map(i=>
      '<div class="ci"><div><div class="ci-name">'+i.name+'</div><div class="ci-unit">฿'+fmt(i.price)+' × '+i.qty+'</div></div><div class="ci-tot">฿'+fmt(i.subtotal)+'</div></div>'
    ).join('')
    const disc=s.discount>0?'<div style="font-size:14px;opacity:.75">ส่วนลด −฿'+fmt(s.discount)+'</div>':''
    const qrSrc=s.qr_url||cfg.payment_qr||''
    const qrEl=qrSrc
      ?'<img class="qimg" src="'+qrSrc+'" alt="QR">'
      :'<div style="width:180px;height:180px;background:#f1f5f9;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:64px">📱</div>'
    app.innerHTML=\`
      <div class="split">
        <div class="pL cart-l">
          <div class="cart-hdr"><h2>รายการสินค้า</h2></div>
          <div class="cart-body">\${rows}</div>
        </div>
        <div class="pR qr-r" style="gap:8px">
          <div class="qtitle" style="color:rgba(255,255,255,0.75);font-size:16px">สแกนเพื่อชำระเงิน</div>
          \${qrEl}
          <div style="font-size:48px;font-weight:800;line-height:1">฿\${fmt(s.total)}</div>
          \${disc}
          <div style="font-size:13px;opacity:.6">รองรับทุกธนาคาร · PromptPay</div>
        </div>
      </div>
    \`
    return
  }

  /* ── PAID ── */
  if(s.status==='paid'){
    app.innerHTML=\`
      <div class="fs paid-fs">
        <div class="paid-card">
          <div class="ic">🧾</div>
          <div class="p1">กรุณา</div>
          <div class="p2">รับใบเสร็จ</div>
          <div class="p3">จากพนักงาน</div>
          <div class="p4">ขอบคุณที่ใช้บริการ 🙏</div>
        </div>
      </div>
    \`
    return
  }
}

function toggleMute(){
  const v=document.getElementById('vidPlayer')
  const f=document.getElementById('ytFrame')
  const btn=document.getElementById('muteBtn')
  _ytMuted=!_ytMuted
  if(btn)btn.textContent=_ytMuted?'🔇':'🔊'
  // YouTube: reload iframe without mute param (ต้องการ user interaction ก่อน)
  if(f&&f.style.display!=='none'&&_ytBaseSrc){
    f.src=ytSrc(_ytBaseSrc)
  }
  // Direct video
  if(v&&v.style.display!=='none'){v.muted=_ytMuted}
}

render()
loadCfg()

let _clockTimer=null
function startClock(){
  if(_clockTimer) return
  function tick(){
    const el=document.getElementById('clock-time')
    const de=document.getElementById('clock-date')
    if(!el||!de) return
    const now=new Date()
    el.textContent=now.toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})
    de.textContent=now.toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',weekday:'long',day:'numeric',month:'long',year:'numeric'})
  }
  tick()
  _clockTimer=setInterval(tick,1000)
}
function stopClock(){
  if(_clockTimer){clearInterval(_clockTimer);_clockTimer=null}
}

const _origRender=render
render=function(){
  stopClock()
  _origRender()
  if(state.status==='idle') startClock()
}
if(state.status==='idle') startClock()

let _receiptTimer=null
sb.channel(CHANNEL)
  .on('broadcast',{event:'pos'},({payload})=>{
    if(_receiptTimer){clearTimeout(_receiptTimer);_receiptTimer=null}
    state=payload; render()
    if(payload.status==='paid'){
      _receiptTimer=setTimeout(()=>{
        state={status:'idle',items:[],subtotal:0,discount:0,total:0}
        render(); _receiptTimer=null
      },7000)
    }
  })
  .subscribe()
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
