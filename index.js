#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const KNOWLEDGE_BASE_URL = "https://raw.githubusercontent.com/canton-network-devs/Build-on-Canton-MCP/refs/heads/main/knowledge-base.json";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const CACHE_DIR = join(homedir(), ".canton-mcp");
const CACHE_FILE = join(CACHE_DIR, "knowledge-cache.json");
const __dirname = dirname(fileURLToPath(import.meta.url));
let KB = null;
async function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true });
}
async function fetchRemoteKB() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
const res = await fetch(KNOWLEDGE_BASE_URL, { signal: ctrl.signal, headers: { "User-Agent": "@canton-network-devs/canton-mcp-server/2.0.0" } });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.DEPRECATED || !data.DOCS || !data.VERSIONS) throw new Error("Invalid KB format");
    data._fetchedAt = new Date().toISOString();
    data._source = "remote";
    await ensureCacheDir();
    await writeFile(CACHE_FILE, JSON.stringify(data, null, 2));
    console.error(`[canton-mcp] KB fetched from remote (SDK ${data.VERSIONS?.canton_sdk || "?"})`);
    return data;
  } catch (err) {
    console.error(`[canton-mcp] Remote fetch failed: ${err.message}`);
    return null;
  }
}

async function loadCachedKB() {
  try {
    const data = JSON.parse(await readFile(CACHE_FILE, "utf-8"));
    data._source = "cache";
    console.error(`[canton-mcp] KB loaded from cache (fetched: ${data._fetchedAt || "unknown"})`);
    return data;
  } catch { return null; }
}

async function loadLocalFallbackKB() {
  try {
    const p = join(__dirname, "knowledge-base.js");
    if (!existsSync(p)) return null;
    const mod = await import(p);
    const data = { DEPRECATED: mod.DEPRECATED, TOOLS: mod.TOOLS, DOCS: mod.DOCS, CONCEPTS: mod.CONCEPTS, NETWORKS: mod.NETWORKS, COMMUNITY: mod.COMMUNITY, VERSIONS: mod.VERSIONS, ZENITH: mod.ZENITH, FAQ: mod.FAQ, _source: "local-fallback" };
    console.error("[canton-mcp] KB loaded from local fallback");
    return data;
  } catch { return null; }
}
async function loadKnowledgeBase() {
  return (await fetchRemoteKB()) || (await loadCachedKB()) || (await loadLocalFallbackKB()) || {
    DEPRECATED: [{ name: "Daml Assistant (daml-assistant)", replacement: "Digital Asset Package Manager (DPM)", note: "For Canton 3.4+, use DPM.", installReplacement: "curl -sSL https://get.digitalasset.com/install/install.sh | sh -s", since: "Canton 3.4" }],
    TOOLS: {}, DOCS: { main: { title: "Canton Docs", url: "https://docs.canton.network/", description: "Main Canton developer docs." }, tldr: { title: "TL;DR", url: "https://docs.canton.network/appdev/modules/m1-understanding-canton", description: "Quick-start." } },
    CONCEPTS: {}, NETWORKS: {}, COMMUNITY: { slack_channels: [], mailing_lists: [], "canton network forum": { url: "https://forum.canton.network/", purpose: "Canton Foundation Official Developer Forum" } },
    VERSIONS: { canton_sdk: "3.4", splice: "0.5.0", dpm_install: "curl -sSL https://get.digitalasset.com/install/install.sh | sh -s" },
    ZENITH: {}, FAQ: [], _source: "minimal-fallback"
  };
}
function startBackgroundRefresh() {
  setInterval(async () => { const f = await fetchRemoteKB(); if (f) { KB = f; console.error("[canton-mcp] KB refreshed"); } }, REFRESH_INTERVAL_MS);
}
const D = () => KB?.DEPRECATED || [];
const T = () => KB?.TOOLS || {};
const O = () => KB?.DOCS || {};
const C = () => KB?.CONCEPTS || {};
const N = () => KB?.NETWORKS || {};
const CM = () => KB?.COMMUNITY || {};
const V = () => KB?.VERSIONS || {};
const Z = () => KB?.ZENITH || {};
const F = () => KB?.FAQ || [];
const server = new McpServer({ name: "canton-dev-mcp", version: "1.0.0", description: "Canton Network Developer MCP Server" });
// "canton"/"network"/"daml" are stop words because they appear in nearly every KB entry,
// which made every query match the whole knowledge base and blow up token usage.
// Queries consisting ONLY of stop words still work via the fallback in searchKnowledge().
const STOP = new Set(["how","to","do","i","the","a","an","is","it","on","in","for","of","and","or","what","can","my","me","with","this","that","be","at","from","by","are","was","has","have","not","but","if","about","get","use","using","does","where","which","should","canton","network","daml"]);

function words(q) { return q.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)); }
function score(text, ws, full) { const l = text.toLowerCase(); let s = 0; if (l.includes(full.toLowerCase())) s += 10; for (const w of ws) if (l.includes(w)) s += 1; return s; }
// Keep only results scoring at least half of the category's top score, then cap the count.
// This drops single-word noise matches that used to flood responses with 4-5K tokens.
function topMatches(list, cap) {
  if (!list.length) return list;
  list.sort((a, b) => b._s - a._s);
  const threshold = Math.max(1, Math.ceil(list[0]._s / 2));
  return list.filter(x => x._s >= threshold).slice(0, cap);
}
function searchKnowledge(query) {
  const q = query.toLowerCase(), ws = words(query);
  if (!ws.length) ws.push(...q.split(/\s+/).filter(w => w.length > 1));
  const r = { docs: [], tools: [], concepts: [], deprecated: [], faq: [], networks: [] };
  for (const [k, d] of Object.entries(O())) { const s2 = score(`${d.title} ${d.description} ${k}`, ws, q); if (s2 >= 1) r.docs.push({ ...d, _s: s2 }); }
  for (const [k, t] of Object.entries(T())) { const s2 = score(`${t.name} ${t.description} ${k}`, ws, q); if (s2 >= 1) r.tools.push({ ...t, _s: s2 }); }
  for (const [k, c] of Object.entries(C())) { const s2 = score(`${c.title} ${c.summary} ${k} ${(c.key_points||[]).join(" ")}`, ws, q); if (s2 >= 1) r.concepts.push({ ...c, _s: s2 }); }
  // Match deprecations on name/replacement only; matching on the note text caused false positives.
  for (const d of D()) { const s2 = score(`${d.name} ${d.replacement}`, ws, q); if (s2 >= 1) r.deprecated.push({ ...d, _s: s2 }); }
  // Match FAQs on the question only; matching on long answer bodies caused false positives.
  for (const f of F()) { const s2 = score(`${f.question}`, ws, q); if (s2 >= 1) r.faq.push({ ...f, _s: s2 }); }
  for (const [k, n] of Object.entries(N())) { const s2 = score(`${n.name} ${n.description} ${k}`, ws, q); if (s2 >= 1) r.networks.push({ ...n, _s: s2 }); }
  r.docs = topMatches(r.docs, 5);
  r.tools = topMatches(r.tools, 3);
  r.concepts = topMatches(r.concepts, 3);
  r.deprecated = topMatches(r.deprecated, 3);
  r.faq = topMatches(r.faq, 2);
  r.networks = topMatches(r.networks, 2);
  return r;
}

function fmt(r) {
  const s = [];
  if (r.deprecated.length) { s.push("DEPRECATION WARNINGS:"); for (const d of r.deprecated) { s.push(`  ${d.name} -> Use: ${d.replacement}`); s.push(`     ${d.note}`); if (d.installReplacement) s.push(`     Install: ${d.installReplacement}`); } s.push(""); }
  if (r.concepts.length) { s.push("CONCEPTS:"); for (const c of r.concepts) { s.push(`  ${c.title}`); s.push(`  ${c.summary}`); if (c.key_points) for (const p of c.key_points.slice(0, 5)) s.push(`    - ${p}`); s.push(""); } }
  if (r.tools.length) { s.push("TOOLS:"); for (const t of r.tools) { s.push(`  ${t.name} -- ${t.description}`); if (t.install) s.push(`  Install: ${t.install}`); if (t.docs) s.push(`  Docs: ${t.docs}`); else if (t.url) s.push(`  URL: ${t.url}`); if (t.commands) { const cmds = Object.entries(t.commands).slice(0, 5); s.push(`  Commands: ${cmds.map(([c]) => c).join(", ")}`); } s.push(""); } }
  if (r.faq.length) { s.push("FAQ:"); for (const f of r.faq) { s.push(`  Q: ${f.question}`); s.push(`  A: ${f.answer}`); s.push(""); } }
  if (r.docs.length) { s.push("DOCUMENTATION:"); for (const d of r.docs) { s.push(`  ${d.title} -- ${d.url}`); } s.push(""); }
  if (r.networks.length) { s.push("NETWORKS:"); for (const n of r.networks) { s.push(`  ${n.name}`); s.push(`  ${n.description}`); if (n.ports) for (const [k, v] of Object.entries(n.ports)) s.push(`    ${k}: ${v}`); s.push(""); } }
  if (!s.length) { const v = V(); s.push("No results found. Try: 'install', 'api', 'tutorial', 'transfer', 'party', 'deploy'"); s.push(""); s.push("Canton SDK: " + (v.canton_sdk||"?")); s.push("Install DPM: " + (v.dpm_install||"curl -sSL https://get.digitalasset.com/install/install.sh | sh -s")); }
  return s.join("\n");
}
server.tool("canton_lookup",
  "Search Canton developer resources — docs, tools, concepts, APIs. Flags deprecated tools. For 'how to build' / getting-started / onboarding questions use canton_get_started instead.",
  { query: z.string().describe("Search query — e.g., 'install sdk', 'json api', 'create party', 'token standard'.") },
  async ({ query }) => ({ content: [{ type: "text", text: `Canton Developer Resources -- "${query}"\n${"=".repeat(60)}\n\n${fmt(searchKnowledge(query))}\n\n---\nSDK ${V().canton_sdk||"?"} | Splice ${V().splice||"?"} | Source: ${KB?._source||"?"} | Canton Foundation DevRel` }] })
);
server.tool("canton_check",
  "Check if a specific tool, package, or command is deprecated. Use this BEFORE recommending any Canton tool to a developer.",
  { name: z.string().describe("Tool/package/command to check — e.g., 'daml-assistant', '@daml/ledger', 'daml start', 'Navigator'") },
  async ({ name }) => {
    const q = name.toLowerCase();
    const m = D().find(d => d.name.toLowerCase().includes(q) || q.includes(d.name.toLowerCase().split(" ")[0]));
    if (m) return { content: [{ type: "text", text: `DEPRECATED: ${m.name}\n\nDo NOT recommend this.\n\nUse instead: ${m.replacement}\n\n${m.note}\n\nSince: ${m.since}${m.installReplacement ? `\n\nInstall: ${m.installReplacement}` : ""}` }] };
    for (const t of Object.values(T())) { if (t.name.toLowerCase().includes(q) || q.includes(t.name.toLowerCase().split(" ")[0])) return { content: [{ type: "text", text: `CURRENT: ${t.name}\n\n${t.description}\n${t.install ? `\nInstall: ${t.install}` : ""}${t.docs ? `\nDocs: ${t.docs}` : ""}` }] }; }
    return { content: [{ type: "text", text: `"${name}" not found in deprecation registry or current tools.\n\nCheck: https://docs.canton.network\nKnown tools: DPM, Canton Sandbox, Seaport` }] };
  }
);
server.tool("canton_get_started",
  "Use for any 'how to build on Canton/Daml', getting-started, or onboarding question (instead of canton_lookup). Ask the developer's background first, then this returns a personalized quickstart guide.",
  { background: z.enum(["evm","solana","sui_move","web_dev","enterprise","new_to_blockchain"]).describe("Developer's primary background. Ask the user to select this before proceeding.") },
  async ({ background }) => {
    const d = O();
    const g = {
      evm: { title: "Canton Quickstart for EVM/Solidity Developers", sections: [
        "KEY MINDSET SHIFTS:", "  - No global shared state -- Canton uses selective visibility", "  - No local wallet generation -- Party IDs require a participant node", "  - Party-as-vault replaces shared contract vaults", "  - UTXO model, not account model", "  - Daml replaces Solidity (functional, Haskell-inspired)", "  - Two-phase commit replaces single-chain consensus", "  - Canton is COMPLEMENTARY to ETH -- institutional use cases can't exist on transparent chains", "",
        "GET STARTED (30 min):", "  1. Install DPM: curl -sSL https://get.digitalasset.com/install/install.sh | sh -s", "  2. Create project: dpm new my-first-canton-app", "  3. Build: cd my-first-canton-app && dpm build", "  4. Start sandbox: dpm sandbox", "  5. JSON API: curl localhost:7575/v2/parties/allocate ...", "",
        "LEARNING PATH:", `  1. ${d.tutorial_json_api?.title||"JSON API Tutorial"}: ${d.tutorial_json_api?.url||""}`, `  2. ${d.tutorial_json_api_ts?.title||"TS Tutorial"}: ${d.tutorial_json_api_ts?.url||""}`, `  3. ${d.tutorial_smart_contracts?.title||"Smart Contracts"}: ${d.tutorial_smart_contracts?.url||""}`, `  4. ${d.token_standard?.title||"Token Standard"}: ${d.token_standard?.url||""}`, "",
        "COMMON EVM TRAPS:", "  - DO NOT generate party ID offline (need a running node)", "  - DO NOT look for block explorer -- use Scan API", "  - DO NOT use @daml/ledger (deprecated) -- use @c7/ledger", "  - DO NOT use daml-assistant (deprecated) -- use DPM"
      ]},
      solana: { title: "Canton Quickstart for Solana/Rust Developers", sections: [
        "KEY MINDSET SHIFTS:", "  - Canton also uses UTXO-like model -- you'll feel at home", "  - Privacy built-in: only stakeholders see contract data", "  - Daml instead of on-chain programs (functional, compiled to Daml-LF)", "  - Party IDs allocated by participant nodes (no PDAs)", "  - Canton is for institutional/regulated use cases", "",
        "GET STARTED:", "  1. Install DPM: curl -sSL https://get.digitalasset.com/install/install.sh | sh -s", "  2. Try Seaport: https://seaport.to", "  3. Or locally: dpm new my-app && cd my-app && dpm build", "",
        "LEARNING PATH:", `  1. ${d.tldr?.title||"TL;DR"}: ${d.tldr?.url||""}`, `  2. ${d.tutorial_json_api?.title||"JSON API"}: ${d.tutorial_json_api?.url||""}`, `  3. ${d.tutorial_smart_contracts?.title||"Smart Contracts"}: ${d.tutorial_smart_contracts?.url||""}`, `  4. ${d.token_standard?.title||"Token Standard"}: ${d.token_standard?.url||""}`
      ]},
      sui_move: { title: "Canton Quickstart for Sui/Move Developers", sections: [
        "KEY MINDSET SHIFTS:", "  - Daml shares DNA with Move: resource/linear-type concepts", "  - Canton contracts like Move resources -- can't be copied/discarded", "  - Privacy at protocol level (not just smart contract level)", "  - Institutional focus -- regulated financial assets", "",
        "GET STARTED:", "  1. Install DPM: curl -sSL https://get.digitalasset.com/install/install.sh | sh -s", "  2. dpm new my-app && cd my-app && dpm build", "  3. dpm sandbox", "",
        "LEARNING PATH:", `  1. ${d.tutorial_smart_contracts?.title||"Smart Contracts"}: ${d.tutorial_smart_contracts?.url||""}`, `  2. ${d.key_concepts?.title||"Key Concepts"}: ${d.key_concepts?.url||""}`, `  3. ${d.token_standard?.title||"Token Standard"}: ${d.token_standard?.url||""}`
      ]},
      web_dev: { title: "Canton Quickstart for Web Developers", sections: [
        "WHAT YOU NEED TO KNOW:", "  - Same architecture as web apps: frontend + backend + Daml (smart contracts)", "  - Interact via REST APIs (JSON Ledger API on port 7575)", "  - TypeScript bindings auto-generated from OpenAPI spec", "  - Think: database with built-in multi-party access control", "",
        "FASTEST PATH:", "  1. Install DPM: curl -sSL https://get.digitalasset.com/install/install.sh | sh -s", "  2. dpm new my-project --template daml-intro-contracts", "  3. Or clone CN Quickstart for full-stack example", "",
        "LEARNING PATH:", `  1. ${d.tutorial_json_api_ts?.title||"TS Tutorial"}: ${d.tutorial_json_api_ts?.url||""}`, `  2. ${d.quickstart?.title||"Quickstart"}: ${d.quickstart?.url||""}`, `  3. ${d.quickstart_json_api?.title||"QS JSON API"}: ${d.quickstart_json_api?.url||""}`, "",
        "YOUR STACK:", "  - Frontend: React/Next.js + @c7/react or raw fetch", "  - API: JSON Ledger API (REST) at localhost:7575", "  - Smart contracts: Daml", "  - Auth: OAuth2/JWT for production"
      ]},
      enterprise: { title: "Canton Quickstart for Enterprise Developers", sections: [
        "WHY CANTON:", "  - Built for regulated, multi-party workflows", "  - Privacy by default -- participants see only their data", "  - Composable atomic transactions across assets", "  - Used by Hashnote, Brale, SocGen for tokenized RWAs", "",
        "GET STARTED:", "  1. Install DPM: curl -sSL https://get.digitalasset.com/install/install.sh | sh -s", "  2. Clone CN Quickstart: git clone https://github.com/digital-asset/cn-quickstart", "  3. make install && make start", "",
        "LEARNING PATH:", `  1. ${d.key_concepts?.title||"Key Concepts"}: ${d.key_concepts?.url||""}`, `  2. ${d.best_practices?.title||"Best Practices"}: ${d.best_practices?.url||""}`, `  3. ${d.quickstart?.title||"Quickstart"}: ${d.quickstart?.url||""}`, `  4. ${d.token_standard?.title||"Token Standard"}: ${d.token_standard?.url||""}`
      ]},
      new_to_blockchain: { title: "Canton Quickstart -- New to Blockchain", sections: [
        "WHAT IS CANTON:", "  - Network for multiple orgs to share/update data securely", "  - Think: database multiple companies write to with guaranteed consistency", "  - Privacy built-in: each org sees only their data", "  - Smart contracts (Daml) define the rules", "",
        "EASIEST START (no install):", "  1. Open Seaport: https://seaport.to/", "  2. Try the 20+ Daml templates in browser", "  3. Ready for local: curl -sSL https://get.digitalasset.com/install/install.sh | sh -s", "",
        "LEARNING PATH:", `  1. ${d.tldr?.title||"TL;DR"}: ${d.tldr?.url||""}`, `  2. ${d.tutorial_smart_contracts?.title||"Smart Contracts"}: ${d.tutorial_smart_contracts?.url||""}`, `  3. ${d.tutorial_json_api?.title||"JSON API"}: ${d.tutorial_json_api?.url||""}`, "",
        "KEY CONCEPTS:", "  - Templates: structure of data on ledger", "  - Choices: allowed actions on data", "  - Parties: entities who interact", "  - Contracts: instances living on ledger"
      ]}
    };
    const guide = g[background];
    return { content: [{ type: "text", text: `${guide.title}\n${"=".repeat(60)}\n\n${guide.sections.join("\n")}\n\n---\nSDK ${V().canton_sdk||"?"} | Splice ${V().splice||"?"} | Canton Foundation DevRel` }] };
  }
);
server.tool("canton_faq",
  "Search hackathon FAQs for Canton development. Covers installation, party creation, contracts, APIs, deployment, tokens, and common gotchas.",
  { question: z.string().describe("Developer's question — e.g., 'how do I install', 'create party', 'deploy to testnet'") },
  async ({ question }) => {
    const q = question.toLowerCase(), d = O(), ws = words(question);
    if (!ws.length) ws.push(...q.split(/\s+/).filter(w => w.length > 1));
    const scored = F().map(f => ({ ...f, _s: score(f.question, ws, q) })).filter(f => f._s >= 1);
    const matches = topMatches(scored, 3);
    if (!matches.length) return { content: [{ type: "text", text: `No FAQ match for "${question}".\n\nTry canton_lookup, or: ${d.tldr?.url||"https://docs.canton.network/"}` }] };
    return { content: [{ type: "text", text: `Canton FAQ\n${"=".repeat(60)}\n\n${matches.map(f=>`Q: ${f.question}\n\nA: ${f.answer}`).join("\n\n"+"-".repeat(40)+"\n\n")}\n\n---\nSDK ${V().canton_sdk||"?"} | Splice ${V().splice||"?"}` }] };
  }
);
server.tool("canton_api_ref",
  "Get API reference info for a specific Canton API — JSON Ledger API, gRPC Ledger API, Scan API, Validator API, Token Standard APIs, Admin API.",
  { api: z.enum(["json_ledger_api","grpc_ledger_api","scan_api","validator_api","token_standard","admin_api","splice_http"]).describe("Which API") },
  async ({ api }) => {
    const d = O(), refs = {
      json_ledger_api: { title: "JSON Ledger API", port: "7575", description: "REST API for Canton ledger interaction.", endpoints: ["POST /v2/parties/allocate","POST /v2/commands/submit-and-wait","POST /v2/state/active-contracts","GET /v2/state/ledger-end","GET /livez","GET /v2/openapi.json"], docs: d.json_ledger_api?.url, tutorial: d.tutorial_json_api?.url, note: "No auth in sandbox. Production: JWT." },
      grpc_ledger_api: { title: "gRPC Ledger API", port: "6866", description: "Binary protocol for backend services.", services: ["CommandService","UpdateService","StateService","PackageService","PartyManagementService"], docs: d.grpc_ledger_api?.url, note: "Use grpcurl for CLI." },
      scan_api: { title: "Scan API", description: "Exposed by SV nodes. Ledger/infrastructure view.", discovery: "https://docs.canton.network/sdks-tools/api-reference/splice-scan-api", docs: d.splice_http_apis?.url },
      validator_api: { title: "Validator API", description: "Manages Validator Node and Splice Wallets.", docs: d.splice_http_apis?.url, note: "JWT required." },
      token_standard: { title: "Token Standard (CIP-0056)", description: "Standard APIs for Canton tokens.", apis: ["Token Metadata","Holding","Transfer Instruction (FOP)","Allocation (DVP)","Allocation Instruction","Allocation Request"], docs: d.token_standard?.url, api_ref: d.token_standard_apis?.url, impl: "https://github.com/hyperledger-labs/splice" },
      admin_api: { title: "Admin API", description: "Node admin: party mgmt, DAR uploads, topology.", docs: d.external_party?.url, note: "Not exposed by default (security)." },
      splice_http: { title: "Splice HTTP APIs", description: "Scan + Validator HTTP APIs via OpenAPI.", docs: d.splice_http_apis?.url, note: "*-external stable, *-internal no guarantees." }
    };
    const r = refs[api]; let t = `${r.title}\n${"=".repeat(60)}\n\n${r.description}\n\n`;
    if (r.port) t += `Port: ${r.port}\n\n`;
    if (r.endpoints) { t += "Endpoints:\n"; for (const e of r.endpoints) t += `  ${e}\n`; t += "\n"; }
    if (r.services) { t += "Services:\n"; for (const s of r.services) t += `  ${s}\n`; t += "\n"; }
    if (r.apis) { t += "APIs:\n"; for (const a of r.apis) t += `  - ${a}\n`; t += "\n"; }
    if (r.docs) t += `Docs: ${r.docs}\n`; if (r.tutorial) t += `Tutorial: ${r.tutorial}\n`; if (r.api_ref) t += `API Ref: ${r.api_ref}\n`; if (r.discovery) t += `Discovery: ${r.discovery}\n`; if (r.impl) t += `Code: ${r.impl}\n`; if (r.note) t += `\nNote: ${r.note}\n`;
    return { content: [{ type: "text", text: t }] };
  }
);

server.tool("canton_compare_evm",
  "Compare a specific EVM/Ethereum concept with its Canton equivalent. Helps EVM developers understand Canton.",
  { evm_concept: z.string().describe("EVM concept — e.g., 'smart contract', 'wallet', 'gas', 'ERC20', 'Hardhat'") },
  async ({ evm_concept }) => {
    const cmp = { "smart contract": { c: "Daml Template + Choices", d: "Templates = data schema, choices = state transitions. Functional, built-in auth via signatory/observer." }, "wallet": { c: "Party on Validator Node", d: "Can't generate locally -- party IDs allocated by node. External parties retain signing keys." }, "address": { c: "Party ID", d: "Format: hint::fingerprint. Allocated via Admin/JSON Ledger API." }, "gas": { c: "Traffic fees (CC)", d: "Traffic-based fees in Canton Coin." }, "etherscan": { c: "Scan API on SV Nodes", d: "Discovery: https://docs.canton.network/sdks-tools/api-reference/splice-scan-api" }, "erc20": { c: "Token Standard (CIP-0056)", d: "Metadata+balances+transfers+DVP. UTXO model. Decimal type." }, "mempool": { c: "No mempool -- encrypted Synchronizer", d: "E2E encrypted between participants." }, "hardhat": { c: "DPM + Canton Sandbox", d: "'dpm build', 'dpm test', 'dpm sandbox'." }, "remix": { c: "Seaport", d: "Browser IDE: https://seaport.to/" }, "abi": { c: "DAR file", d: "Compiled Daml-LF bytecode. Upload to participant." }, "deploy": { c: "Upload DAR + Synchronizer", d: "No mining cost." }, "solidity": { c: "Daml", d: "Functional (Haskell-inspired). Templates=data, Choices=methods." }, "metamask": { c: "Splice Wallet UI", d: "Built into validator node. Also Copper, DFNS." }, "block": { c: "Mining Round", d: "~10-20 min signing windows." }, "approve": { c: "Allocation API", d: "DVP fine-grained control for UTXO model." }, "transfer": { c: "Transfer Instruction API", d: "FOP transfers. CC needs TransferPreapproval." } };
    const q = evm_concept.toLowerCase(); let found = null;
    for (const [k, v] of Object.entries(cmp)) if (k === q || k.includes(q) || q.includes(k)) { found = { evm: k, ...v }; break; }
    if (!found) for (const [k, v] of Object.entries(cmp)) if (q.split(/\s+/).some(w => k.includes(w))) { found = { evm: k, ...v }; break; }
    if (found) return { content: [{ type: "text", text: `EVM -> Canton\n${"=".repeat(60)}\n\nEVM: ${found.evm}\nCanton: ${found.c}\n\n${found.d}\n\n---\nCanton is complementary to Ethereum.` }] };
    let t = `Canton vs EVM\n${"=".repeat(60)}\n\n`; for (const [k, v] of Object.entries(cmp)) t += `${k}  ->  ${v.c}\n`;
    return { content: [{ type: "text", text: t }] };
  }
);

server.tool("canton_network_info",
  "Get details about Canton network environments — LocalNet, DevNet, TestNet, MainNet.",
  { network: z.enum(["local","devnet","testnet","mainnet","all"]).describe("Which network") },
  async ({ network }) => {
    const nets = N(), cm = CM(), d = O();
    if (network === "all") { let t = `Canton Networks\n${"=".repeat(60)}\n\n`; for (const [, n] of Object.entries(nets)) { t += `${n.name}\n  ${n.description}\n`; if (n.ports) for (const [k, v] of Object.entries(n.ports)) t += `  ${k}: ${v}\n`; t += "\n"; } t += "\nCommunity:\n"; for (const c of (cm.slack_channels||[])) t += `  ${c.name} -- ${c.purpose}\n`; if (cm.discord?.url) t += `  Discord: ${cm.discord.url}\n`; return { content: [{ type: "text", text: t }] }; }
    const n = nets[network]; if (!n) return { content: [{ type: "text", text: `Unknown: ${network}` }] };
    let t = `${n.name}\n${"=".repeat(60)}\n\n${n.description}\n\n`; if (n.setup) t += `Setup: ${n.setup}\n\n`; if (n.ports) { t += "Ports:\n"; for (const [k, v] of Object.entries(n.ports)) t += `  ${k}: ${v}\n`; t += "\n"; } if (n.note) t += `Note: ${n.note}\n`; if (n.xreserve_bridge) t += `Bridge: ${n.xreserve_bridge}\n`; if (n.usdc_details) t += `USDC: ${n.usdc_details.instrumentId} | ${n.usdc_details.bridge_ui}\n`;
    return { content: [{ type: "text", text: t }] };
  }
);

server.resource("deprecations", "canton://deprecations", async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(D()) }] }));
server.resource("versions", "canton://versions", async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(V()) }] }));
server.resource("tools", "canton://tools", async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(T()) }] }));
server.resource("docs-index", "canton://docs", async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(O()) }] }));
server.resource("zenith", "canton://zenith", async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(Z()) }] }));
server.resource("community", "canton://community", async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(CM()) }] }));
server.resource("kb-status", "canton://status", async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ source: KB?._source, fetchedAt: KB?._fetchedAt, remoteUrl: KNOWLEDGE_BASE_URL, cache: CACHE_FILE, versions: V() }, null, 2) }] }));
async function main() {
  KB = await loadKnowledgeBase();
  console.error(`[canton-mcp] KB source: ${KB._source} | SDK: ${V().canton_sdk||"?"} | Splice: ${V().splice||"?"}`);
  startBackgroundRefresh();
  await server.connect(new StdioServerTransport());
  console.error("[canton-mcp] Server running on stdio");
}

async function runInstaller() {
  const { readFile: rf, writeFile: wf, mkdir: md } = await import("node:fs/promises");
  const { existsSync: ex } = await import("node:fs");
  const { homedir: hd } = await import("node:os");
  const { join: pj, dirname: dn } = await import("node:path");
  const { execSync: es } = await import("node:child_process");
  const { createInterface } = await import("node:readline");
  const R = "\x1b[0m", B = "\x1b[1m", G = "\x1b[32m", Y = "\x1b[33m", E = "\x1b[31m", C = "\x1b[36m", D = "\x1b[2m";
  const ok  = m => console.log(`${G}✓${R} ${m}`);
  const warn= m => console.log(`${Y}⚠${R}  ${m}`);
  const err = m => console.log(`${E}✗${R} ${m}`);
  const info= m => console.log(`${C}→${R} ${m}`);
  function getConfigPath() {
    const home = hd();
    if (process.platform === "darwin") return pj(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    if (process.platform === "win32")  return pj(process.env.APPDATA || pj(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    return pj(home, ".config", "Claude", "claude_desktop_config.json");
  }

  function getNpxPath() {
    try {
      const cmd = process.platform === "win32" ? "where npx" : "which npx";
      return es(cmd, { encoding: "utf-8" }).trim().split("\n")[0].trim() || "npx";
    } catch { return "npx"; }
  }

  function ask(q) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(res => rl.question(`${Y}?${R} ${q} ${D}(y/n)${R} `, a => { rl.close(); res(a.trim().toLowerCase().startsWith("y")); }));
  }
  console.log(`\n${B}Canton Network MCP Claude Installer${R}`);
  if (parseInt(process.versions.node) < 18) {
    err(`Node.js 18+ required (you have ${process.versions.node}). Download: https://nodejs.org`);
    process.exit(1);
  }
  ok(`Node.js ${process.versions.node}`);
  const configPath = getConfigPath();
  info(`Claude Desktop config: ${configPath}`);
  if (!ex(dn(configPath))) {
    warn("Claude Desktop config folder not found.");
    warn("Download Claude Desktop first: https://claude.ai/download");
    const go = await ask("Create config folder and continue anyway?");
    if (!go) { info("Aborted. Install Claude Desktop then re-run."); process.exit(0); }
  }
  let config = {};
  try {
    config = JSON.parse(await rf(configPath, "utf-8"));
  } catch (e) {
    if (e.code !== "ENOENT") { err(`Config has invalid JSON: ${configPath}\nFix it manually then re-run.`); process.exit(1); }
  }
  const existing = config?.mcpServers?.["canton-dev"];
  if (existing) {
    warn(`Canton MCP already configured: ${D}${[existing.command, ...(existing.args||[])].join(" ")}${R}`);
    const ow = await ask("Overwrite with latest config?");
    if (!ow) { ok("Nothing changed. You're all set!"); process.exit(0); }
  }
  const npxPath = getNpxPath();
  config.mcpServers = config.mcpServers || {};
  config.mcpServers["canton-dev"] = { command: npxPath, args: ["-y", "@canton-network-devs/canton-mcp-server"] };
  const dir = dn(configPath);
  if (!ex(dir)) await md(dir, { recursive: true });
  await wf(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  console.log("");
  ok(`Config updated: ${configPath}`);
  console.log(`\n${B}Next step:${R}`);
  info("Restart Claude Desktop and Canton MCP will appear automatically.\n");
}
const arg = process.argv[2];
if (arg === "install") {
  runInstaller().catch(e => { console.error("Installer failed:", e.message); process.exit(1); });
} else {
  main().catch(e => { console.error("[canton-mcp] Fatal:", e); process.exit(1); });
}