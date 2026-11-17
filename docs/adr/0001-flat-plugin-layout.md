# ADR 0001: Flat plugin layout

Status: accepted

## Context

The plugin must install on Claude Code, Codex and Copilot, plus skills-only agents. Research note 01 proposed nesting the plugin under `plugins/<name>/`. Prior art (note 08, ATBGamePort) reports clean installs on Claude Code, Codex and Copilot from a flat layout, where the repository root is the plugin.

## Decision

Use a flat layout (design spec section 13):

- the repo root is the plugin;
- `.claude-plugin/plugin.json` lists `skills: ["./skills/port-any-game"]`;
- `.claude-plugin/marketplace.json` uses `"source": "./"`;
- there is one skill, `port-any-game`, with per-agent wrappers (agents, commands, hooks) beside it at the root.

## Consequences

- Simpler than `plugins/<name>/` nesting: one manifest path, no indirection in the marketplace entry.
- The whole repo is the install payload, so tests, docs and fixtures ship with it. Keep them small and legally redistributable.
- `scripts/validate.mjs` enforces the contract: skill frontmatter, name equals folder, relative links, `agents/openai.yaml`, and version sync across manifests.
- If a host later needs a nested layout, a generated variant can be added without changing this one.
