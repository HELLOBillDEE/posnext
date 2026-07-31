'use client'
import { useEffect } from 'react'

function isChunkError(msg) {
  return msg && (msg.includes('Loading chunk') || msg.includes('ChunkLoadError') || msg.includes('Load failed'))
}

export default function ChunkErrorHandler() {
  useEffect(() => {
    function onError(e) {
      if (isChunkError(e?.message)) window.location.reload()
    }
    function onUnhandled(e) {
      if (isChunkError(e?.reason?.message)) window.location.reload()
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
