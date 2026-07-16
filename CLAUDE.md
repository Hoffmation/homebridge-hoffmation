# CLAUDE.md

**Read [`AGENTS.md`](./AGENTS.md) first — it is the source of truth for working in this repo**
This file only adds a Claude Code quick-reference; everything below is a summary of AGENTS.md.

Humans: see [`README.md`](./README.md)

## Non-negotiables (see AGENTS.md for the full text)

- **Stability first.** Controls a real home; ~one deploy/day, rollback is expensive. Minimal-invasive,
  reversible, validated off-production. Never let a change run for the first time in production.
- **YAGNI, backward-compatible by default, reuse before building.**
- **Public repo.** Keep source **English and anonymized** — no personal names, private host names,
  device IDs, or room names in committed code.

## Commands

```bash
npm run build         # WebUI (Vite) + tsc
```

- **Node 24** (see `.nvmrc`); package manager **npm**.
- Formatting/lint is enforced — run ESLint before handing back (Prettier: printWidth 120,
  singleQuote, trailingComma all, 2-space).
