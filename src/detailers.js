// Public detailer cards come from approved employee accounts.
// Ratings and review counts are not stored and are not invented here.

export function publicDetailer(user) {
  if (!user || user.role !== 'employee' || user.status !== 'Approved') return null
  const id = String(user.detailer || '').trim().toLowerCase()
  if (!/^[a-z0-9]{1,40}$/.test(id)) return null
  const name = String(user.name || '').trim()
  if (!name) return null
  return {
    id,
    name,
    city: String(user.profile?.city || '').trim(),
    bio: String(user.profile?.bio || '').trim(),
    services: String(user.profile?.services || '').trim(),
    years: String(user.profile?.years || '').trim(),
  }
}

export function publicDetailers(users) {
  const cards = []
  const seen = new Map()
  for (const user of Array.isArray(users) ? users : []) {
    const card = publicDetailer(user)
    if (!card) continue
    const count = (seen.get(card.id) || 0) + 1
    seen.set(card.id, count)
    if (count > 1) card.id = `${card.id}-${count}`
    cards.push(card)
  }
  cards.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return cards
}
