import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

function waitForServerReady(child, port) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Server did not start in time"));
    }, 10000);

    const onData = (chunk) => {
      const text = chunk.toString();
      if (text.includes(`Vault API running on port ${port}`)) {
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        resolve();
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
  });
}

test("server responds on localhost", async () => {
  const port = 3101;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServerReady(child, port);
    await delay(250);

    const response = await fetch(
      `http://127.0.0.1:${port}/api/vault/${"0".repeat(64)}`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.exists, false);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
  }
});
