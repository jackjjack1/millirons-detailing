// Where /api calls go. First-party hosts talk to their own Pages Functions.
// A Google AI Studio preview (and any other foreign host) talks to production
// unless VITE_API_BASE was set to an http(s) origin at build time.

export const PRODUCTION_API = 'https://millironsdetailing.com'

export function isRelativeApiHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'millironsdetailing.com' || host === 'www.millironsdetailing.com') return true
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  if (host === 'pages.dev' || host.endsWith('.pages.dev')) return true
  return false
}

export function normalizeApiBase(configured) {
  if (typeof configured !== 'string') return ''
  const trimmed = configured.trim()
  if (!trimmed) return ''
  let url
  try { url = new URL(trimmed) } catch { return '' }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
  if (url.username || url.password) return ''
  return url.origin
}

export function resolveApiBase(hostname, configured) {
  const explicit = normalizeApiBase(configured)
  if (explicit) return explicit
  if (isRelativeApiHost(hostname)) return ''
  return PRODUCTION_API
}

export function apiBase(loc = typeof location === 'undefined' ? undefined : location) {
  let configured = ''
  try {
    const value = import.meta.env.VITE_API_BASE
    if (typeof value === 'string') configured = value
  } catch { configured = '' }
  return resolveApiBase(loc && loc.hostname, configured)
}

export function apiUrl(path, loc) {
  const base = apiBase(loc)
  const suffix = String(path || '').startsWith('/') ? String(path || '') : '/' + String(path || '')
  return base ? base + suffix : suffix
}

export function apiFetch(path, init = {}, loc) {
  return fetch(apiUrl(path, loc), {...init, credentials: 'include'})
}
