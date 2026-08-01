# Canton Network MCP Server

When developers use AI tools to learn Canton, they get recommended deprecated documentation links. This MCP integration **solves that**, it provides a curated, auto-updating knowledge base covering Canton's dev stack and guides developers from zero to deployed.

> **Note:** This MCP gives AI models the right links and context, but does not guarantee 100% correct AI output by nature of how LLMs work. If something's wrong, [open a GitHub issue](https://github.com/canton-network-devs/Build-on-Canton-MCP/issues) and we'll update the knowledge base.

## Install for Claude Desktop

One command

```bash
npx @canton-network-devs/canton-mcp-server install
```

That's it. Restart Claude Desktop and the Canton tools appear automatically.

**Requirements:** Node.js 18+ · Claude Desktop

## How it works

The server fetches its knowledge base from `knowledge-base.json` in this repo on startup and refreshes it every hour. When we push an update, every user picks it up on their next restart, no manual pulls needed.

Tool responses identify the knowledge-base version, update time, source, and
freshness state. The `canton://status` resource exposes the same metadata in
JSON. Knowledge older than 45 days is marked `stale`; callers should verify
time-sensitive release and network-version claims against their primary
upstream source.

## Updating the Knowledge Base

Edit `knowledge-base.json` at the repo root. Every MCP user picks up the update on their next restart.

PRs welcome!
