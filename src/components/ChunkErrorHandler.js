'use client'
import { useEffect } from 'react'

function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode:standalone)').matches
}

function isChunkError(msg) {
  if (!msg) return false
  return msg.includes('Loading chunk') || msg.includes('ChunkLoadError')
}

function hardReload() {
  // ไม่ reload ใน PWA standalone — inline chunk-guard ก็ skip เหมือนกัน
  if (isStandalone()) return
  // localStorage dedup — ป้องกันวนซ้ำแม้ router ล้าง URL param
  const KEY = 'chunk_reload_ts'
  try {
    const last = parseInt(localStorage.getItem(KEY) || '0')
    if (Date.now() - last < 30000) return
    localStorage.setItem(KEY, String(Date.now()))
  } catch {}
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
