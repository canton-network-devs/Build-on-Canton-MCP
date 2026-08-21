// Ad-hoc harness: spawns the MCP server over stdio and measures tool response sizes.
// Usage: node test-token-usage.mjs [path-to-index.js]
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const serverPath = process.argv[2] || "./index.js";
const proc = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
proc.stderr.on("data", () => {});
const rl = createInterface({ input: proc.stdout });

const pending = new Map();
let nextId = 1;
rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  } catch {}
});
function send(method, params) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((res) => pending.set(id, res));
}

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } });
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const queries = [
  "canton token transfer api",
  "create party",
  "install sdk",
  "how to deploy daml contract on canton testnet",
  "canton network validator node setup",
  "daml",
];
for (const q of queries) {
  const r = await send("tools/call", { name: "canton_lookup", arguments: { query: q } });
  const text = r.result?.content?.[0]?.text || "";
  console.log(`canton_lookup "${q}" -> ${text.length} chars (~${Math.round(text.length / 3.5)} tokens)`);
}
const faq = await send("tools/call", { name: "canton_faq", arguments: { question: "how do I create a party" } });
const ft = faq.result?.content?.[0]?.text || "";
console.log(`canton_faq "how do I create a party" -> ${ft.length} chars (~${Math.round(ft.length / 3.5)} tokens)`);

const tools = await send("tools/list", {});
const schemaSize = JSON.stringify(tools.result?.tools || []).length;
console.log(`tools/list schema -> ${schemaSize} chars (~${Math.round(schemaSize / 3.5)} tokens)`);

proc.kill();
process.exit(0);
