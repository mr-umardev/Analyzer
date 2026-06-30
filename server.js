import express from "express";
import pg from "pg";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Use Postgres when DATABASE_URL is provided, otherwise fall back to
// a simple file-based JSON store so the API can run locally without DB setup.
const usePostgres = Boolean(process.env.DATABASE_URL);
let pool = null;
const vaultFile = join(__dirname, "vault.json");
if (usePostgres) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
} else {
  // Minimal file-backed "DB" with the same external behaviour used by handlers.
  pool = {
    query: async (sql, params = []) => {
      // Support only the queries used by this app: CREATE TABLE, SELECT and INSERT/UPDATE.
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith("CREATE TABLE")) {
        // ensure file exists
        if (!existsSync(vaultFile))
          writeFileSync(vaultFile, JSON.stringify({}));
        return { rows: [] };
      }
      if (trimmed.startsWith("SELECT")) {
        const token = params[0];
        if (!existsSync(vaultFile)) return { rows: [] };
        const data = JSON.parse(readFileSync(vaultFile, "utf8") || "{}");
        if (!data[token]) return { rows: [] };
        return {
          rows: [{ salt: data[token].salt, payload: data[token].payload }],
        };
      }
      // INSERT ... ON CONFLICT -> upsert
      if (trimmed.startsWith("INSERT")) {
        const [token, salt, payloadStr] = params;
        let data = {};
        if (existsSync(vaultFile))
          data = JSON.parse(readFileSync(vaultFile, "utf8") || "{}");
        try {
          const payload =
            typeof payloadStr === "string"
              ? JSON.parse(payloadStr)
              : payloadStr;
          data[token] = { salt, payload, updated_at: new Date().toISOString() };
        } catch {
          data[token] = {
            salt,
            payload: payloadStr,
            updated_at: new Date().toISOString(),
          };
        }
        writeFileSync(vaultFile, JSON.stringify(data, null, 2));
        return { rows: [] };
      }
      if (trimmed.startsWith("DELETE")) {
        const token = params[0];
        if (!existsSync(vaultFile)) return { rows: [] };
        const data = JSON.parse(readFileSync(vaultFile, "utf8") || "{}");
        if (data[token]) {
          delete data[token];
          writeFileSync(vaultFile, JSON.stringify(data, null, 2));
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

app.use(express.json({ limit: "4mb" }));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vault (
      token VARCHAR(64) PRIMARY KEY,
      salt TEXT NOT NULL,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

app.get("/api/vault/:token", async (req, res) => {
  const { token } = req.params;
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).json({ error: "Invalid token" });
  }
  try {
    const result = await pool.query(
      "SELECT salt, payload FROM vault WHERE token = $1",
      [token],
    );
    if (result.rows.length === 0) {
      return res.json({ exists: false });
    }
    return res.json({
      exists: true,
      salt: result.rows[0].salt,
      payload: result.rows[0].payload,
    });
  } catch {
    return res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/vault", async (req, res) => {
  const { token, salt, payload } = req.body;
  if (!token || !salt || !payload) {
    return res.status(400).json({ error: "Missing fields" });
  }
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).json({ error: "Invalid token" });
  }
  try {
    await pool.query(
      `INSERT INTO vault (token, salt, payload, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (token) DO UPDATE SET payload = $3, updated_at = NOW()`,
      [token, salt, JSON.stringify(payload)],
    );
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Database error" });
  }
});

app.delete("/api/vault/:token", async (req, res) => {
  const { token } = req.params;
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).json({ error: "Invalid token" });
  }

  try {
    await pool.query("DELETE FROM vault WHERE token = $1", [token]);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Database error" });
  }
});

const distPath = join(__dirname, "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("/*splat", (_req, res) => res.sendFile(join(distPath, "index.html")));
}

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3001);
initDb()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Vault API running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialise database:", err);
    process.exit(1);
  });
