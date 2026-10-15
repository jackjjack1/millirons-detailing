import {apiFetch} from './apiOrigin.js'

async function request(path, body) {
  let response
  try {
    response = await apiFetch(path, {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      headers: body ? {'content-type': 'application/json'} : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Could not reach shared operations storage.')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || 'Shared operations request failed.')
    error.status = response.status
    throw error
  }
  return data
}

export const opsGet = resource => request(`/api/ops?resource=${encodeURIComponent(resource)}`)
export const opsAction = (resource, action, fields = {}) => request('/api/ops', {resource, action, ...fields})

export async function opsMigrate(snapshot) {
  return request('/api/ops', {action: 'migrate', snapshot})
}
