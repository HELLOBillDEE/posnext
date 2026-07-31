'use client'
import { useEffect } from 'react'

export default function ChunkErrorHandler() {
  useEffect(() => {
    function onError(e) {
      if (e?.message?.includes('Loading chunk') || e?.message?.includes('ChunkLoadError')) {
        window.location.reload()
      }
    }
    window.addEventListener('error', onError)
    return () => window.removeEventListener('error', onError)
  }, [])
  return null
}
