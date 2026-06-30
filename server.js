import express from 'express'
import pg from 'pg'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

app.use(express.json({ limit: '4mb' }))

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vault (
      token VARCHAR(64) PRIMARY KEY,
      salt TEXT NOT NULL,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

app.get('/api/vault/:token', async (req, res) => {
  const { token } = req.params
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).json({ error: 'Invalid token' })
  }
  try {
    const result = await pool.query(
      'SELECT salt, payload FROM vault WHERE token = $1',
      [token]
    )
    if (result.rows.length === 0) {
      return res.json({ exists: false })
    }
    return res.json({ exists: true, salt: result.rows[0].salt, payload: result.rows[0].payload })
  } catch {
    return res.status(500).json({ error: 'Database error' })
  }
})

app.post('/api/vault', async (req, res) => {
  const { token, salt, payload } = req.body
  if (!token || !salt || !payload) {
    return res.status(400).json({ error: 'Missing fields' })
  }
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).json({ error: 'Invalid token' })
  }
  try {
    await pool.query(
      `INSERT INTO vault (token, salt, payload, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (token) DO UPDATE SET payload = $3, updated_at = NOW()`,
      [token, salt, JSON.stringify(payload)]
    )
    return res.json({ success: true })
  } catch {
    return res.status(500).json({ error: 'Database error' })
  }
})

const distPath = join(__dirname, 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (_req, res) => res.sendFile(join(distPath, 'index.html')))
}

const PORT = Number(process.env.PORT || 3001)
initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Vault API running on port ${PORT}`)
    })
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err)
    process.exit(1)
  })
