'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

function fmt(n) {
  if (!n && n !== 0) return '—'
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

const MONTH_NAMES = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

export default function CommissionPage() {
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(false)
  const [techData, setTechData] = useState([])  // [{ emp, laborTotal, commission, jobs }]
  const [expanded, setExpanded] = useState(null) // tech_id

  const load = useCallback(async () => {
    setLoading(true)
    setTechData([])
    try {
      const startDate = new Date(year, month - 1, 1).toISOString()
      const endDate   = new Date(year, month, 1).toISOString()

      // 1. Sales in the selected month (not voided)
      const { data: salesInMonth } = await supabase
        .from('sales').select('id')
        .gte('created_at', startDate).lt('created_at', endDate)
        .neq('status', 'voided')
      if (!salesInMonth?.length) { setLoading(false); return }

      const saleIds = salesInMonth.map(s => s.id)

      // 2. Repair orders paid in that month
      const { data: repairOrders } = await supabase
        .from('repair_orders').select('id,repair_no,customer_name,device,sale_id,technician_id,technician_name')
        .in('sale_id', saleIds)

      const repairIds = (repairOrders || []).map(r => r.id)

      // 3. Quotations for those repairs (items JSONB)
      const quotationsPromise = repairIds.length
        ? supabase.from('quotations').select('repair_order_id,items').in('repair_order_id', repairIds)
        : Promise.resolve({ data: [] })

      // 4. Employees + POS sale_items ที่แท็กช่างไว้ (ดึงพร้อมกัน)
      const [{ data: quotations }, { data: employees }, { data: posRepairItems }] = await Promise.all([
        quotationsPromise,
        supabase.from('employees').select('id,name,nickname,repair_commission_pct').eq('active', true),
        supabase.from('sale_items').select('sale_id,product_name,qty,price,technician_name')
          .in('sale_id', saleIds)
          .ilike('product_name', '%ค่าซ่อม%')
          .not('technician_name', 'is', null)
          .neq('technician_name', ''),
      ])

      if (!repairIds.length && !posRepairItems?.length) { setLoading(false); return }

      // 5. Build repair map: repair_order_id → repair info + items
      const repairMap = {}
      repairOrders.forEach(r => { repairMap[r.id] = { ...r, items: [] } })
      ;(quotations || []).forEach(q => {
        if (repairMap[q.repair_order_id]) {
          repairMap[q.repair_order_id].items = Array.isArray(q.items) ? q.items : []
        }
      })

      // 6. Aggregate by tech
      const empMap = {}
      ;(employees || []).forEach(e => {
        empMap[e.id] = { emp: e, laborTotal: 0, jobs: [] }
      })

      // helper: find empMap key by nickname/name string
      const findEmpId = (techName) => {
        const emp = (employees || []).find(e => (e.nickname || e.name) === techName)
        return emp?.id ?? null
      }

      Object.values(repairMap).forEach(repair => {
        repair.items.forEach(item => {
          if (!item.is_labor || !item.tech_id) return
          const labor = (parseFloat(item.price) || 0) * (parseFloat(item.qty) || 1)
          if (!empMap[item.tech_id]) return
          empMap[item.tech_id].laborTotal += labor
          const existingJob = empMap[item.tech_id].jobs.find(j => j.repair_id === repair.id)
          if (existingJob) {
            existingJob.labor += labor
            existingJob.items.push(item)
          } else {
            empMap[item.tech_id].jobs.push({
              repair_id: repair.id,
              repair_no: repair.repair_no,
              customer_name: repair.customer_name,
              device: repair.device,
              labor,
              items: [item],
            })
          }
        })
      })

      // 6b. รวมรายการ "ค่าซ่อม" จาก POS
      ;(posRepairItems || []).forEach(si => {
        const empId = findEmpId(si.technician_name)
        if (!empId || !empMap[empId]) return
        const labor = (parseFloat(si.price) || 0) * (parseFloat(si.qty) || 1)
        empMap[empId].laborTotal += labor
        empMap[empId].jobs.push({
          repair_id: `pos-${si.sale_id}`,
          repair_no: 'POS',
          customer_name: '—',
          device: si.product_name,
          labor,
          items: [{ name: si.product_name, qty: si.qty, price: si.price }],
        })
      })

      const result = Object.values(empMap)
        .filter(d => d.laborTotal > 0)
        .map(d => ({
          ...d,
          commission: Math.ceil(d.laborTotal * (parseFloat(d.emp.repair_commission_pct) || 0) / 100),
        }))
        .sort((a, b) => b.commission - a.commission)

      setTechData(result)
    } catch (e) {
      alert('โหลดข้อมูลไม่ได้: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { load() }, [load])

  const totalComm = techData.reduce((s, d) => s + d.commission, 0)

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg,#14060a 0%,#2D142C 100%)', fontFamily: 'Kanit,sans-serif' }}>
      <div className="max-w-2xl mx-auto px-4 py-6 pb-24">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <a href="/repair" className="text-white/40 hover:text-white text-2xl leading-none">←</a>
          <div>
            <h1 className="text-2xl font-bold text-white">💰 คอมมิชชั่นช่าง</h1>
            <p className="text-white/40 text-sm">ค่าแรงซ่อมที่ชำระแล้วในเดือนที่เลือก</p>
          </div>
        </div>

        {/* Month selector */}
        <div className="flex gap-2 mb-6">
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="flex-1 px-3 py-2.5 rounded-xl text-sm text-white outline-none"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>
            {MONTH_NAMES.map((m, i) => (
              <option key={i+1} value={i+1}>{m}</option>
            ))}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="w-28 px-3 py-2.5 rounded-xl text-sm text-white outline-none"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>
            {[now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1].map(y => (
              <option key={y} value={y}>{y + 543}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-20 text-white/40">กำลังโหลด...</div>
        ) : techData.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-3">📊</div>
            <p className="text-white/40">ยังไม่มีข้อมูลคอมมิชชั่นในเดือนนี้</p>
            <p className="text-white/25 text-xs mt-1">ต้องมีงานซ่อมที่ชำระแล้ว และ tag ค่าแรง + ช่าง ไว้</p>
          </div>
        ) : (
          <>
            {/* Summary card */}
            <div className="rounded-2xl p-4 mb-4 flex justify-between items-center"
              style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}>
              <div>
                <p className="text-xs text-violet-300/70">คอมมิชชั่นรวมทั้งหมด</p>
                <p className="text-2xl font-bold text-violet-300">฿{fmt(totalComm)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-violet-300/70">จำนวนช่าง</p>
                <p className="text-xl font-bold text-violet-200">{techData.length} คน</p>
              </div>
            </div>

            {/* Tech rows */}
            <div className="space-y-3">
              {techData.map(d => {
                const pct = parseFloat(d.emp.repair_commission_pct) || 0
                const isOpen = expanded === d.emp.id
                return (
                  <div key={d.emp.id} className="rounded-2xl overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <button className="w-full px-4 py-4 flex items-center gap-3 text-left"
                      onClick={() => setExpanded(isOpen ? null : d.emp.id)}>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold flex-shrink-0"
                        style={{ background: 'rgba(124,58,237,0.25)', color: '#c4b5fd' }}>
                        {(d.emp.nickname || d.emp.name).charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-white">{d.emp.nickname || d.emp.name}</p>
                        <p className="text-xs text-white/40">{d.jobs.length} งาน · ค่าแรงรวม ฿{fmt(d.laborTotal)} · {pct}%</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-violet-300 text-lg">฿{fmt(d.commission)}</p>
                        <p className="text-xs text-white/30">{isOpen ? '▲' : '▼'}</p>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t px-4 pb-3 space-y-2" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                        {d.jobs.map(j => (
                          <div key={j.repair_id} className="py-2 border-b last:border-0"
                            style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-semibold text-white">{j.customer_name} — {j.device}</p>
                                <p className="text-xs text-white/40">{j.repair_no}</p>
                              </div>
                              <div className="text-right flex-shrink-0 ml-3">
                                <p className="text-sm font-bold text-emerald-400">฿{fmt(Math.ceil(j.labor * pct / 100))}</p>
                                <p className="text-xs text-white/30">ค่าแรง ฿{fmt(j.labor)}</p>
                              </div>
                            </div>
                            <div className="mt-1 space-y-0.5">
                              {j.items.map((it, ii) => (
                                <p key={ii} className="text-xs text-white/40 pl-2">· {it.name} ×{it.qty} = ฿{fmt((parseFloat(it.price)||0)*(parseFloat(it.qty)||1))}</p>
                              ))}
                            </div>
                          </div>
                        ))}
                        <div className="flex justify-between pt-1">
                          <span className="text-xs text-violet-300/60">รวมค่าคอม {d.emp.nickname || d.emp.name}</span>
                          <span className="text-sm font-bold text-violet-300">฿{fmt(d.commission)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
