import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";

const server = await createServer();
await server.listen();
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, AGENTALK_DEV_URL: "http://127.0.0.1:5178" },
});
const stop = async () => {
  child.kill();
  await server.close();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
