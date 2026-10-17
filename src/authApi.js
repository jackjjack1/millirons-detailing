// Browser client for /api/auth and /api/hire. The session cookie is HttpOnly, so this
// module never reads or writes the password or the session token. credentials:
// 'include' lets the AI Studio preview send the cross-site session cookie.
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
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed.')
    error.status = response.status
    if (data.chooseRole) {
      error.chooseRole = true
      error.roles = Array.isArray(data.roles) ? data.roles : []
    }
    throw error
  }
  return data
}

export const ACCOUNTS_EVENT = 'md-accounts'
export function notifyAccounts() { dispatchEvent(new Event(ACCOUNTS_EVENT)) }

export const authSetupStatus = () => api('/api/auth/setup')
export const authSetup = body => api('/api/auth/setup', {method: 'POST', body})
export const authLogin = body => api('/api/auth/login', {method: 'POST', body})
export const authLogout = () => api('/api/auth/logout', {method: 'POST', body: {}})
export const authViewAs = role => api('/api/auth/view-as', {method: 'POST', body: {role}})
export async function authMe() {
  let response
  try {
    response = await apiFetch('/api/auth/me', {cache: 'no-store'})
  } catch {
    return null
  }
  if (response.status === 401) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Could not check the session.')
  return data.user || null
}
export const authRegister = body => api('/api/auth/register', {method: 'POST', body})
export function authEmail(email, role) {
  if (role !== 'customer' && role !== 'employee') throw new Error('Could not check that email.')
  return api('/api/auth/email', {method: 'POST', body: {email, role}})
}
export const authApply = body => api('/api/auth/apply', {method: 'POST', body})
export const authPatchMe = body => api('/api/auth/me', {method: 'PATCH', body})
export const authAccounts = () => api('/api/auth/accounts')
export const authDecide = body => api('/api/auth/accounts', {method: 'PATCH', body})
export const authInvites = () => api('/api/auth/invites')
export const authCreateInvite = body => api('/api/auth/invites', {method: 'POST', body})
export const authInviteAction = body => api('/api/auth/invites', {method: 'POST', body})
export const authInvitePreview = token => api('/api/auth/invites/preview?token=' + encodeURIComponent(token || ''))
export const authAcceptInvite = body => api('/api/auth/invites/accept', {method: 'POST', body})
export const authHires = () => api('/api/hire')
export const authCreateHire = body => api('/api/hire', {method: 'POST', body})
export const authPatchHire = body => api('/api/hire', {method: 'PATCH', body})
export const authDeleteHire = id => api('/api/hire?id=' + encodeURIComponent(id), {method: 'DELETE'})
