export async function loadVault(token) {
  const res = await fetch(`/api/vault/${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(`Load vault failed: ${res.status}`)
  return res.json()
}

export async function saveVault(token, salt, payload) {
  const res = await fetch('/api/vault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, salt, payload }),
  })
  if (!res.ok) throw new Error(`Save vault failed: ${res.status}`)
  return res.json()
}

export async function deleteVault(token) {
  const res = await fetch(`/api/vault/${encodeURIComponent(token)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`Delete vault failed: ${res.status}`)
  return res.json()
}
