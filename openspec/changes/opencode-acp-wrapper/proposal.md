## Why

Ora ("../desktop") will eventually have a Rust plugin manager that acts as a generic ACP (Agent Client Protocol) client: it spawns a plugin executable and speaks ACP with it over stdio (ndjson JSON-RPC) — the same contract regardless of which coding agent sits behind the plugin. OpenCode already implements the ACP agent role natively via `opencode acp`, but it isn't yet packaged as something Ora's plugin manager can spawn directly as a self-contained, versioned plugin. This repo builds that plugin: a thin relay that presents itself to Ora as an ACP agent, while internally driving a pinned `opencode acp` process. This is the first of several planned agent plugins (others — Claude, and an in-house agent that doesn't fully implement ACP — are separate future changes) and establishes the pattern the rest will follow.

## What Changes

- Build a standalone TypeScript (Bun) project that, at runtime, exposes two ACP roles from `@agentclientprotocol/sdk` back to back:
  - An **agent role** (`agent({ name })`) facing upward toward whatever spawned this process (Ora's future plugin manager, or a manual test harness today).
  - A **client role** (`client({ name })`) facing downward toward a spawned `opencode acp` child process.
  - Each agent-role handler's implementation simply forwards the call through the client role to the real `opencode acp` process and relays the result back — a transparent relay, not a reinterpretation of ACP semantics.
- Depend on `opencode-ai` as a normal, version-pinned project dependency (not a globally-installed binary discovered via `PATH`), resolving the `opencode` executable from this project's own `node_modules`.
- Propagate child process lifecycle transparently: if the `opencode acp` child exits (crash or otherwise), this process exits too, so the parent (Ora's ACP client) observes a single, unambiguous "the agent process ended" signal rather than a custom error protocol.
- **BREAKING** (relative to the previous version of this change): completely replaces the earlier HTTP/WebSocket facade design (custom session-lifecycle API, permission-bridge translation, update-streaming event schema, per-workspace process registry). None of that is needed once the external interface is raw ACP over stdio instead of a bespoke network API.

## Capabilities

### New Capabilities
- `acp-relay-proxy`: Dual-role (agent-facing-up, client-facing-down) transparent relay of ACP JSON-RPC traffic between whatever spawns this process and a child `opencode acp` process, using `@agentclientprotocol/sdk` for both roles.
- `opencode-process-management`: Resolving and spawning the project-local, version-pinned `opencode acp` binary, and propagating its lifecycle (including crashes) to this process's own lifecycle.

### Modified Capabilities
(none — the previous `acp-session-lifecycle`, `acp-permission-bridge`, and `acp-update-streaming` capabilities from the earlier version of this change are removed outright; see Impact.)

## Impact

- Removes the previously specified HTTP/WS facade surface, custom event schema, and permission-bridge translation entirely — replaced by raw ACP passthrough.
- New runtime dependency: `opencode-ai` (project dependency, pinned version) providing the `opencode acp` binary; `@agentclientprotocol/sdk` for the relay's own agent/client role implementations.
- No network surface: the plugin communicates exclusively over its own stdin/stdout (ACP ndjson), matching how any ACP client (Zed, and eventually Ora's Rust plugin manager) already expects to talk to an agent.
- Explicitly out of scope for this change (deferred to later changes): compiling to a standalone single-file binary via `bun build --compile` and bundling into Ora's Tauri sidecar packaging; Ora's own Rust-side plugin manager / generic ACP client; logging/telemetry of ACP traffic; message interception ("seasoning") hooks; adapting other agents (Claude, in-house agents without full ACP support) into this plugin pattern.
