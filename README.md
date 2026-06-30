# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Vault API (local development)

- The server in `server.js` will use `process.env.DATABASE_URL` to connect to Postgres in production.
- For local development, if `DATABASE_URL` is not provided, the server falls back to a simple file-backed store at `vault.json` so the API works without a database.
- Run the server with:

```powershell
node server.js
```

The API will listen on port `3001` by default. Use `127.0.0.1:3001` when testing from Node to avoid IPv6 resolution issues.
