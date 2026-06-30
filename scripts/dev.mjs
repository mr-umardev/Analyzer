import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const isWindows = process.platform === "win32";
const serverEnv = {
  ...process.env,
  HOST: process.env.HOST || "127.0.0.1",
  PORT: process.env.PORT || "3001",
};
const viteEnv = {
  ...process.env,
  HOST: process.env.HOST || "127.0.0.1",
};

const server = spawn(process.execPath, ["server.js"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: serverEnv,
});

const viteBin = join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin], {
  cwd: projectRoot,
  stdio: "inherit",
  env: viteEnv,
});

const shutdown = (signal) => {
  if (!server.killed) server.kill(signal);
  if (!vite.killed) vite.kill(signal);
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(signal);
  });
}

server.on("exit", (code, signal) => {
  if (!vite.killed) {
    vite.kill(signal || "SIGTERM");
  }
  process.exit(code ?? 0);
});

vite.on("exit", (code, signal) => {
  if (!server.killed) {
    server.kill(signal || "SIGTERM");
  }
  process.exit(code ?? 0);
});
