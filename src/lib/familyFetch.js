const TOKEN = process.env.NEXT_PUBLIC_FAMILY_API_SECRET || ''

export function familyFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}), 'x-family-token': TOKEN }
  return fetch(url, { ...opts, headers })
}
