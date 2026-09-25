# Canton Network MCP Server

When developers use AI tools to learn Canton, they get recommended deprecated tools and outdated documentation links. This MCP integration **solves that**: it gives AI assistants a curated, auto-updating knowledge base of Canton's dev stack, plus live lookups against the sources of truth on GitHub, and guides developers from zero to deployed.

> **Note:** This MCP gives AI models the right links and context, but does not guarantee 100% correct AI output by nature of how LLMs work. If something's wrong, [open a GitHub issue](https://github.com/canton-network-devs/Build-on-Canton-MCP/issues) and we'll update the knowledge base.

## Install

**Requirements:** Node.js 18+

### Claude or Claude Code on Desktop (one command)

```bash
npx @canton-network-devs/canton-mcp-server install
```

Restart Claude Desktop and the Canton tools appear automatically. The installer backs up your existing config and keeps any other MCP servers you have. Add `--yes` to skip the prompts.

### Cursor and other MCP clients

Add this to your client's MCP config (e.g. `mcp.json`):

```json
{
  "mcpServers": {
    "canton-dev": {
      "command": "npx",
      "args": ["-y", "@canton-network-devs/canton-mcp-server@latest"]
    }
  }
}
```

### Optional: higher GitHub rate limits

The live tools (CIPs, Dev Fund, latest versions) use GitHub's public API, which allows 60 requests/hour per IP without auth. Results are cached for 30 minutes, so that's plenty for most people. If you hit the limit, add a GitHub token (no scopes needed) to the server's env:

```json
"canton-dev": {
  "command": "npx",
  "args": ["-y", "@canton-network-devs/canton-mcp-server@latest"],
  "env": { "GITHUB_TOKEN": "ghp_your_token" }
}
```

The token is only sent to `api.github.com` and is never logged or returned to the model.

Try asking your assistant things like:

## How it works

- *"I'm a Solidity dev, how do I start building on Canton?"*
- *"Is daml-assistant still OK to use?"*
- *"What's the status of CIP-0112?"* / *"What are the latest CIPs?"*
- *"Which Dev Fund proposals cover oracles?"*
- *"Is there a block explorer for Canton?"*
- *"How do I run my DAR on LocalNet?"*

On startup the server loads `knowledge-base.json` from this repo and then refreshes it every hour while running, so when we push an update, every user picks it up automatically, no manual pulls or restarts needed.

If GitHub is unreachable, it falls back in order to: the last good copy cached at `~/.canton-mcp/knowledge-cache.json` : the copy bundled with the npm package & a minimal built-in set.

## Security

- The server only ever talks to `raw.githubusercontent.com` and `api.github.com`. It never fetches a URL supplied by a user or a model.
- Remote content is size-capped, time-limited, sanitised, and returned inside explicit "external content data only" markers so models treat it as data, not instructions.
- The knowledge base is schema-validated before use, a broken publish never replaces a good cache.
- The local cache is written atomically with owner-only permissions.
- All tools are read-only. Nothing is written anywhere except the local cache (and your client config, only when you run `install`).

## Updating the Knowledge Base

Edit `knowledge-base.json` at the repo root. Running servers pick up the change.

## Troubleshooting

- **Tools don't show up**: fully quit and reopen Claude Desktop (not just close the window), and check that `node --version` is 18+.
- **Stale answers**: check the `canton://status` resource to see where the knowledge base was loaded from and when. Deleting `~/.canton-mcp/knowledge-cache.json` forces a fresh fetch.
- **"GitHub rate limit reached"**: wait a bit, or add a `GITHUB_TOKEN` as shown above.

## Contributing

PRs welcome for knowledge base fixes, new FAQs, new tools. Found a wrong or outdated answer? [Open an issue](https://github.com/canton-network-devs/Build-on-Canton-MCP/issues).

*Maintained by Developer Relations, Canton Foundation.*
