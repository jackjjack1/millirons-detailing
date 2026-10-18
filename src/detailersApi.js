import {apiFetch} from './apiOrigin.js'

export async function detailersList() {
  let response
  try {
    response = await apiFetch('/api/detailers', {cache: 'no-store'})
  } catch {
    throw new Error('Could not load detailers.')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Could not load detailers.')
  return {detailers: Array.isArray(data.detailers) ? data.detailers : []}
}
