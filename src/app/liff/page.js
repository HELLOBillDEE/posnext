'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LiffHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [biz, setBiz]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      try {
        const liff = (await import('@line/liff')).default
        await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID })
        if (!liff.isLoggedIn()) { liff.login(); return }
        const profile = await liff.getProfile()
        setUser(profile)

        // ดึงข้อมูล business ของ user
        const res = await fetch('/api/family/setup')
        const { members } = await res.json()
        const member = members.find(m => m.line_user_id === profile.userId)
        if (member) setBiz(member.family_businesses)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500 text-sm">กำลังโหลด...</p>
      </div>
    </div>
  )

  return (
    <div className="max-w-sm mx-auto p-4 pt-8">
      {/* Header */}
      <div className="text-center mb-8">
        {user?.pictureUrl && (
          <img src={user.pictureUrl} alt="" className="w-14 h-14 rounded-full mx-auto mb-2 border-2 border-white shadow" />
        )}
        <p className="font-semibold text-gray-800">{user?.displayName || 'ผู้ใช้งาน'}</p>
        {biz && (
          <span className="inline-block mt-1 px-3 py-1 rounded-full text-xs text-white font-medium"
            style={{ backgroundColor: biz.color || '#1a56c4' }}>
            🏢 {biz.name}
          </span>
        )}
      </div>

      {/* เมนูหลัก */}
      <div className="space-y-3">
        <button
          onClick={() => router.push('/liff/income')}
          className="w-full bg-green-600 text-white py-4 rounded-2xl font-semibold text-lg shadow active:scale-95 transition-transform flex items-center justify-center gap-3"
        >
          <span className="text-2xl">💰</span>
          <span>เพิ่มรายรับรายวัน</span>
        </button>

        <button
          onClick={() => router.push('/liff/summary')}
          className="w-full bg-blue-600 text-white py-4 rounded-2xl font-semibold text-lg shadow active:scale-95 transition-transform flex items-center justify-center gap-3"
        >
          <span className="text-2xl">📊</span>
          <span>ดูสรุปเดือนนี้</span>
        </button>

        <button
          onClick={() => router.push('/liff/bills')}
          className="w-full bg-orange-500 text-white py-4 rounded-2xl font-semibold text-lg shadow active:scale-95 transition-transform flex items-center justify-center gap-3"
        >
          <span className="text-2xl">📋</span>
          <span>รายการบิล / ค่าใช้จ่าย</span>
        </button>
      </div>

      <p className="text-center text-xs text-gray-400 mt-8">
        💡 ส่งรูปบิลมาในกลุ่ม LINE เพื่อให้ AI อ่านอัตโนมัติ
      </p>
    </div>
  )
}
