'use client'
import { useEffect } from 'react'

function isChunkError(msg) {
  if (!msg) return false
  return msg.includes('Loading chunk') || msg.includes('ChunkLoadError') ||
    msg.includes('Load failed') || msg.includes('400') || msg.includes('Failed to load resource')
}

function hardReload() {
  const url = new URL(window.location.href)
  url.searchParams.set('_r', Date.now())
  window.location.replace(url.toString())
}

export default function ChunkErrorHandler() {
  useEffect(() => {
    function onError(e) {
      if (isChunkError(e?.message)) hardReload()
    }
    function onUnhandled(e) {
      if (isChunkError(e?.reason?.message)) hardReload()
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
