export const dynamic = 'force-dynamic'

export function GET() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Customer Display</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Sarabun',sans-serif;background:#1a1a2e;overflow:hidden;}
    #app{position:fixed;inset:0;display:flex;flex-direction:column;}
    .screen{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
    .idle{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);color:#fff;}
    .idle .ic{font-size:96px;margin-bottom:24px;}
    .idle .t1{font-size:52px;font-weight:700;}
    .idle .t2{font-size:24px;margin-top:12px;opacity:.6;}
    .paid{background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;}
    .paid .ic{font-size:96px;margin-bottom:24px;}
    .paid .t1{font-size:52px;font-weight:700;}
    .paid .t2{font-size:40px;margin-top:16px;opacity:.9;}
    .paying{background:linear-gradient(135deg,#0369a1,#075985);color:#fff;}
    .paying .ic{font-size:80px;margin-bottom:24px;}
    .paying .t1{font-size:40px;font-weight:600;opacity:.9;}
    .paying .t2{font-size:72px;font-weight:700;margin-top:16px;}
    .active{background:#f1f5f9;align-items:stretch;justify-content:flex-start;}
    .hdr{background:linear-gradient(135deg,#C72C41,#801336);color:#fff;padding:14px 24px;flex-shrink:0;}
    .hdr h1{font-size:26px;font-weight:700;}
    .items{flex:1;overflow-y:auto;padding:12px 16px;}
    .item{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;margin-bottom:10px;background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);}
    .iname{font-size:22px;font-weight:600;color:#1e293b;}
    .iprice{font-size:17px;color:#64748b;margin-top:2px;}
    .itotal{font-size:26px;font-weight:700;color:#C72C41;flex-shrink:0;}
    .ftotal{background:#fff;border-top:2px solid #e2e8f0;padding:16px 24px;flex-shrink:0;}
    .frow{display:flex;justify-content:space-between;font-size:20px;color:#64748b;margin-bottom:6px;}
    .fmain{display:flex;justify-content:space-between;font-size:38px;font-weight:700;color:#C72C41;}
  </style>
</head>
<body>
  <div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script>
    const fmt = n => Number(n||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})
    let state = {status:'idle',items:[],subtotal:0,discount:0,total:0}

    function render() {
      const app = document.getElementById('app')
      const s = state
      if (s.status === 'idle') {
        app.innerHTML = '<div class="screen idle"><div class="ic">🛍️</div><div class="t1">ยินดีต้อนรับ</div><div class="t2">กรุณาแจ้งรายการสินค้า</div></div>'
        return
      }
      if (s.status === 'paid') {
        app.innerHTML = '<div class="screen paid"><div class="ic">✅</div><div class="t1">ขอบคุณที่ใช้บริการ!</div><div class="t2">฿' + fmt(s.total) + '</div></div>'
        return
      }
      if (s.status === 'paying') {
        app.innerHTML = '<div class="screen paying"><div class="ic">💳</div><div class="t1">กำลังชำระเงิน</div><div class="t2">฿' + fmt(s.total) + '</div></div>'
        return
      }
      const items = (s.items||[]).map(i =>
        '<div class="item"><div><div class="iname">'+i.name+'</div><div class="iprice">฿'+fmt(i.price)+' × '+i.qty+'</div></div><div class="itotal">฿'+fmt(i.subtotal)+'</div></div>'
      ).join('')
      const disc = s.discount > 0
        ? '<div class="frow"><span>ยอดรวม</span><span>฿'+fmt(s.subtotal)+'</span></div><div class="frow" style="color:#dc2626"><span>ส่วนลด</span><span>−฿'+fmt(s.discount)+'</span></div>'
        : ''
      app.innerHTML = '<div class="screen active"><div class="hdr"><h1>รายการสินค้า</h1></div><div class="items">'+items+'</div><div class="ftotal">'+disc+'<div class="fmain"><span>รวมทั้งหมด</span><span>฿'+fmt(s.total)+'</span></div></div></div>'
    }

    render()

    const sb = window.supabase.createClient('${SUPABASE_URL}', '${SUPABASE_KEY}', {db:{schema:'pos'}})
    sb.channel('customer-display')
      .on('broadcast', {event:'pos'}, ({payload}) => { state = payload; render() })
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
