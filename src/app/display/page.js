'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function DisplayPage() {
  const [state, setState] = useState({ status: 'idle', items: [], subtotal: 0, discount: 0, total: 0 })

  useEffect(() => {
    const ch = supabase.channel('customer-display')
      .on('broadcast', { event: 'pos' }, ({ payload }) => {
        setState(payload)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const { status, items = [], subtotal = 0, discount = 0, total = 0 } = state

  if (status === 'idle') {
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        color: 'white', fontFamily: 'var(--font-kanit), sans-serif',
      }}>
        <div style={{ fontSize: 96, marginBottom: 24, filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.4))' }}>🛍️</div>
        <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '0.02em' }}>ยินดีต้อนรับ</div>
        <div style={{ fontSize: 24, marginTop: 12, opacity: 0.6 }}>กรุณาแจ้งรายการสินค้า</div>
      </div>
    )
  }

  if (status === 'paid') {
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
        color: 'white', fontFamily: 'var(--font-kanit), sans-serif',
      }}>
        <div style={{ fontSize: 96, marginBottom: 24 }}>✅</div>
        <div style={{ fontSize: 52, fontWeight: 700 }}>ขอบคุณที่ใช้บริการ!</div>
        <div style={{ fontSize: 40, marginTop: 16, opacity: 0.9 }}>฿{fmt(total)}</div>
      </div>
    )
  }

  if (status === 'paying') {
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #0369a1 0%, #075985 100%)',
        color: 'white', fontFamily: 'var(--font-kanit), sans-serif',
      }}>
        <div style={{ fontSize: 80, marginBottom: 24 }}>💳</div>
        <div style={{ fontSize: 40, fontWeight: 600, opacity: 0.9 }}>กำลังชำระเงิน</div>
        <div style={{ fontSize: 72, fontWeight: 700, marginTop: 16 }}>฿{fmt(total)}</div>
      </div>
    )
  }

  // active — show cart
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      background: '#f1f5f9', fontFamily: 'var(--font-kanit), sans-serif',
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #C72C41 0%, #801336 100%)',
        color: 'white', padding: '14px 24px', flexShrink: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontSize: 26, fontWeight: 700 }}>รายการสินค้า</div>
      </div>

      {/* Items */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {items.map((item, i) => (
          <div key={i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 18px', marginBottom: 10,
            background: 'white', borderRadius: 12,
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 600, color: '#1e293b' }}>{item.name}</div>
              <div style={{ fontSize: 17, color: '#64748b', marginTop: 2 }}>
                ฿{fmt(item.price)} × {item.qty}
              </div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#C72C41' }}>
              ฿{fmt(item.subtotal)}
            </div>
          </div>
        ))}
      </div>

      {/* Totals footer */}
      <div style={{
        background: 'white', borderTop: '2px solid #e2e8f0',
        padding: '16px 24px', flexShrink: 0,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
      }}>
        {discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, color: '#64748b', marginBottom: 6 }}>
            <span>ยอดรวม</span>
            <span>฿{fmt(subtotal)}</span>
          </div>
        )}
        {discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, color: '#dc2626', marginBottom: 6 }}>
            <span>ส่วนลด</span>
            <span>−฿{fmt(discount)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 38, fontWeight: 700, color: '#C72C41' }}>
          <span>รวมทั้งหมด</span>
          <span>฿{fmt(total)}</span>
        </div>
      </div>
    </div>
  )
}
