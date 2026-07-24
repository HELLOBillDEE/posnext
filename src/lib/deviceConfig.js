const KEY = 'device_config'

export function getDeviceConfig() {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

export function setDeviceConfig(patch) {
  const cur = getDeviceConfig()
  localStorage.setItem(KEY, JSON.stringify({ ...cur, ...patch }))
}

export function getTerminalId()   { return getDeviceConfig().terminal_id   || '' }
export function getTerminalName() { return getDeviceConfig().terminal_name || '' }
