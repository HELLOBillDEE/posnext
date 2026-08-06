'use client'
import { useEffect } from 'react'

function isChunkError(msg) {
  if (!msg) return false
  return msg.includes('Loading chunk') || msg.includes('ChunkLoadError') || msg.includes('Load failed')
}

function hardReload() {
  // ถ้า reload ไปแล้วครั้งหนึ่ง (_r มีอยู่แล้ว) → หยุด ไม่วนซ้ำ
  if (new URL(window.location.href).searchParams.has('_r')) return
  const url = new URL(window.location.href)
  url.searchParams.set('_r', Date.now())
  window.location.replace(url.toString())
}

export default function ChunkErrorHandler() {
  useEffect(() => {
    let fired = false
    function onError(e) {
      if (!fired && isChunkError(e?.message)) { fired = true; hardReload() }
    }
    function onUnhandled(e) {
      if (!fired && isChunkError(e?.reason?.message)) { fired = true; hardReload() }
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandled)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  }, [])
  return null
}
