# Windows work notes

Read this file whenever you're working from Windows and add new findings so the next agent can stay unblocked.

- Browser engine now allowed on Windows; expect more flakiness. If automation fails, rerun with `--engine api --wait` or point `--remote-chrome` to a running Chrome with remote debugging.
- Chrome DevTools via mcporter: `chrome-devtools` server needs `CHROME_DEVTOOLS_URL` from a live session; without it `mcporter call chrome-devtools.*` fails. Expect this to be unset on Windows unless you bring your own Chrome session/URL.
- agent-scripts bash helpers: `runner`/`scripts/committer` can fail under PowerShell/CMD because of CRLF and bash expectations. If they explode, run commands directly (`pnpm ...`, `git add/commit`) instead.
- browser-tools binary: not built in `agent-scripts/bin` on Windows; `pnpm tsx scripts/browser-tools.ts` also fails there (no package manifest). Use a macOS-built binary or run from macOS if you need it.
- Prefer PowerShell + pnpm directly; watch for CRLF warnings when touching tracked files.
- Keep pnpm's project-local virtual store on Windows. `enableGlobalVirtualStore` links worktrees into the shared `%LOCALAPPDATA%\\pnpm\\store\\v10\\links` tree; removing a temporary Git worktree can mutate that shared store and break later installs. If this happens, confirm with `pnpm store status` and repair with a frozen `pnpm install --force` through mise + Corepack.

Future Windows gotchas belong here. Update this doc when you learn something new.

- ChatGPT sidebar/history labels can include phrases like "Login setup instruction"; login probes must match exact auth CTAs, not any visible text starting with login, or manual-login automation loops forever before typing.
- Deep Research export restores can render the `internal://deep-research` iframe at a collapsed height before the report card expands; wait for a full bounding box before clicking the export menu coordinates.
- After completion, a missed first export click is not conclusive: rescan for a stable expanded iframe and retry within a bounded window before saving fallback extraction.
- On Windows, `oracle session <id> --harvest` can time out in its recovered-conversation ready check even when the historical Deep Research page and its sandbox iframe have loaded. Treat harvest readback and Playwright Markdown export as separate paths; inspect the retained Oracle Chrome session before declaring the report non-exportable.
