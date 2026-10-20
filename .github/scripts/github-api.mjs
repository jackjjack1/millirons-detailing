// Small GitHub REST helper. It uses GITHUB_TOKEN and does not print the token.

export function createGitHub(token, fetchImpl = fetch) {
  async function request(method, path, body) {
    const response = await fetchImpl(`https://api.github.com/${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'millirons-team-rules',
        ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = {message: text.slice(0, 200)}
      }
    }
    return {status: response.status, data}
  }

  function fail(method, path, status, data) {
    const message = data && data.message ? String(data.message).slice(0, 300) : 'request failed'
    const error = new Error(`GitHub returned ${status} for ${method} ${path}: ${message}`)
    error.status = status
    return error
  }

  return {
    async get(path) {
      const {status, data} = await request('GET', path)
      if (status < 200 || status >= 300) throw fail('GET', path, status, data)
      return data
    },
    async post(path, body) {
      const {status, data} = await request('POST', path, body)
      if (status < 200 || status >= 300) throw fail('POST', path, status, data)
      return data
    },
    async patch(path, body) {
      const {status, data} = await request('PATCH', path, body)
      if (status < 200 || status >= 300) throw fail('PATCH', path, status, data)
      return data
    },
    async delete(path) {
      const {status, data} = await request('DELETE', path)
      if (status === 204 || status === 404 || status === 422) return {status, data}
      if (status >= 200 && status < 300) return {status, data}
      throw fail('DELETE', path, status, data)
    },
  }
}

export async function getPages(github, path) {
  const all = []
  for (let page = 1; page <= 10; page++) {
    const join = path.includes('?') ? '&' : '?'
    const batch = await github.get(`${path}${join}per_page=100&page=${page}`)
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all
}
