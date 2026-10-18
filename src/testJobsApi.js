import {apiFetch} from './apiOrigin.js'

async function api(path, {method = 'GET', body} = {}) {
  let response
  try {
    response = await apiFetch(path, {
      method,
      cache: 'no-store',
      headers: body ? {'content-type': 'application/json'} : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Could not reach the server.')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Request failed.')
  return data
}

export const testJobsList = () => api('/api/test-jobs')
export const testJobsCreate = body => api('/api/test-jobs', {method: 'POST', body})
export const testJobsDelete = () => api('/api/test-jobs', {method: 'DELETE', body: {confirm: true}})
export const previewTestBooking = booking => api('/api/preview-booking', {method: 'POST', body: {booking}})
