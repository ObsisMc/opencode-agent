## Context

Ora ("../desktop", Rust/Tauri) intends a unified "agent plugin" pattern: a Rust plugin manager acting as a generic ACP client, spawning any plugin executable and speaking ACP (ndjson JSON-RPC over stdio) with it, uniformly regardless of which coding agent backs the plugin. That plugin manager doesn't exist yet (separate, future change); this repo builds the first plugin, for OpenCode, which already implements the ACP agent role natively via `opencode acp`. Other planned plugins (Claude, and an in-house agent that doesn't fully implement ACP) will need a fuller ACP agent-side implementation than OpenCode does; this repo only needs to cover the "OpenCode already speaks ACP well, just relay it" case.

Earlier iterations of this design proposed a custom HTTP/WebSocket facade API (session lifecycle endpoints, a permission-bridge translation layer, a bespoke update-streaming event schema, a per-workspace process registry). That entire layer is discarded: it existed to compensate for not having a real ACP client on the Ora side. Once the premise shifts to "the external interface is raw ACP, spoken over stdio, because that's what any ACP client already expects," none of that custom translation is needed — it would just be reinventing what ACP itself already specifies.

## Goals / Non-Goals

**Goals:**
- Present this process, from the outside (whatever spawns it), as a standards-compliant ACP agent, using `@agentclientprotocol/sdk`'s `agent({ name })` builder — no bespoke wire format.
- Internally drive a real `opencode acp` process using the same SDK's `client({ name })` builder, and relay every ACP call/notification between the two roles without reinterpreting its meaning.
- Bundle `opencode-ai` as a normal, version-pinned dependency of this project, so the exact `opencode acp` binary in use is deterministic and doesn't depend on what happens to be installed globally on the host.
- Propagate the child process's lifecycle (including unexpected exit) as this process's own lifecycle, so the parent ACP client sees ordinary "agent process ended" behavior rather than a custom error signal.

**Non-Goals:**
- Any HTTP/WebSocket server, custom event schema, or network-facing API of any kind — the entire external surface is ACP over stdio.
- Logging/telemetry of ACP traffic, or message interception/"seasoning" hooks — deferred; not designed or implemented in this change (see Risks for how the chosen architecture keeps this cheap to add later).
- Compiling to a standalone single-file binary (`bun build --compile`) or wiring into Ora's Tauri sidecar packaging — deferred to a later change; this change only needs to run via `bun run`.
- Building or designing Ora's Rust-side plugin manager / generic ACP client — separate, future work; this repo has no dependency on it existing yet and can be exercised standalone (e.g. via a manual test harness or an existing ACP client like Zed).
- Adapting any other agent (Claude, in-house agents without full ACP support) into this plugin pattern — separate future changes, likely requiring a fuller ACP agent-side implementation than a relay.

## Decisions

**1. Implement both ACP roles via `@agentclientprotocol/sdk`, wired back to back, instead of hand-parsing ndjson lines.**
The relay registers an `agent({ name })` instance facing upward and a `client({ name })` instance facing downward; every agent-role handler's body simply issues the corresponding call through the client role and returns its result. This gives us the SDK's request/response correlation and framing for free (no custom JSON-RPC id bookkeeping), matches the same official scaffolding OpenCode itself uses to implement `opencode acp`, and keeps a natural per-method seam for future logging or interception (a handler is the natural place to add either, without needing to restructure a raw byte/line pipe later).
- Alternative considered: raw byte or line-based passthrough (pipe `child.stdout` directly to `process.stdout`, or manually `JSON.parse`/`JSON.stringify` each ndjson line) — rejected because it would need to be reworked into a message-aware structure as soon as logging or interception is added, and forgoes the SDK's built-in correlation handling for no real savings.

**2. Depend on `opencode-ai` as a pinned project dependency, not a globally-discovered binary.**
Declaring `opencode-ai` in this project's own `package.json` at an exact version means the `opencode` executable is resolved from this project's own `node_modules` (e.g. `node_modules/.bin/opencode`), deterministically, without a `PATH`-search-and-fail-if-missing dance. This also pins the exact ACP protocol version this relay is validated against, eliminating the version-drift risk that a `PATH`-discovered, arbitrarily-versioned global install would carry.
- Alternative considered: locate `opencode` via an explicit config/env override, then fall back to `PATH`, failing with a descriptive error if neither resolves — rejected as unnecessary complexity now that OpenCode is a normal npm dependency of this project; revisit only if a future need arises to let callers point at a different, externally-managed OpenCode install.

**3. Propagate child process exit as this process's own exit; no custom error protocol.**
If the `opencode acp` child process exits (crash or normal termination), this process exits too (mirroring the exit condition), rather than emitting some bespoke "errored" event. Whatever ACP client is driving this plugin (Ora's future plugin manager, or any other ACP client) already has to handle "the agent process I spawned exited" as a normal case; reusing that instead of inventing a parallel signal keeps the relay's contract identical to spawning `opencode acp` directly.
- Alternative considered: catch the crash and emit an ACP-level error notification before exiting — rejected as unnecessary complication; ACP doesn't define such a notification, and process-exit is already an unambiguous, protocol-agnostic signal every ACP client must already handle.

## Risks / Trade-offs

- **No logging/interception in this change** → If an ACP conformance or behavior bug shows up, there's no traffic log to inspect yet. Mitigated by Decision 1: because each ACP method is a discrete handler (not an opaque byte stream), adding a log statement or interception hook per method later is a small, localized change, not a rework.
- **`opencode-ai` as a pinned dependency means upgrading OpenCode requires a version bump + release of this plugin**, rather than picking up host-installed upgrades automatically → Accepted trade-off; determinism and avoiding version-drift matters more here than always-latest, and bumping a pinned dependency is a routine, low-risk change.
- **No standalone-binary packaging yet** → This plugin cannot yet be handed to an end user as a single file; it currently requires a Bun runtime and `bun run`/`bun install` in this project. Acceptable for this change since Ora's plugin manager (the actual consumer) doesn't exist yet either; both need to land before end-user distribution matters.
- **Relay adds one hop of latency/failure surface between any real ACP client and OpenCode** → Given both hops are local process stdio (no network), the added latency is negligible; the added failure surface (the relay process itself crashing independently of OpenCode) is symmetric with any other spawned-process dependency and is covered by Decision 3's exit propagation.
- **Discovered during implementation: running the unbundled TypeScript directly (`bun run src/index.ts`) hits a Bun runtime bug** where `@agentclientprotocol/sdk`'s `zod` peer dependency resolves against Bun's internal package-cache path instead of this project's `node_modules`, failing with `Cannot find module 'zod/v4'`. This only manifests for ACP calls that go through the SDK's built-in schema validation (which our relay mostly avoids by registering every method with an identity/passthrough parser instead of the typed built-in overloads); it was still hit in manual testing. → Worked around by always running through `bun build`'s bundled output (`bun run build && bun run dist/index.js`, wired as the `start` script) rather than executing the TypeScript source directly; bundling resolves and inlines the import at build time, sidestepping Bun's runtime resolution path. This also happens to be a rehearsal for the deferred single-binary packaging step (Non-Goals), which was always going to go through `bun build` anyway.

## Migration Plan

Greenfield component with no existing consumers; nothing to migrate. This change supersedes the previous (HTTP/WS facade) version of the same proposal outright — no code from that direction exists yet, so there is nothing to roll back beyond discarding the old design/spec files, which this change does.

## Open Questions

- Exact shape of the future logging/interception hook (e.g. a single `onMessage` callback vs. per-method middleware) is left open until that work is actually scoped.
- Whether `opencode-ai`'s own dependency footprint is compatible with a later `bun build --compile` single-binary target (it may itself need asset-embedding work) is unresolved; deferred to the packaging change.
- How Ora's future plugin manager will locate/version this plugin's own executable is out of this repo's control and will be defined when that plugin manager is designed.
