# opencode-agent

An ACP (Agent Client Protocol) relay plugin for OpenCode.

This process presents itself, on its own stdin/stdout, as a standards-compliant
ACP agent (ndjson JSON-RPC), while internally spawning OpenCode's own native
`opencode acp` agent as a child process and transparently relaying every ACP
call and notification between the two — no HTTP, no custom API, no
reinterpretation of ACP semantics. It's the first of several planned "agent
plugin" implementations for a future generic ACP-client plugin manager (e.g.
in `../desktop`); OpenCode already speaks ACP natively, so this plugin is
mostly a thin relay plus the process-management glue (binary resolution,
spawning, lifecycle propagation) that ACP itself doesn't specify.

## Running

```bash
bun install
bun run start   # builds (bun build) and runs the relay
```

`opencode-ai` is installed as a normal, version-pinned project dependency —
the `opencode` binary is resolved from this project's own `node_modules`, not
from your system `PATH` or a separate global install.

### Why `bun run start` builds first

Running the unbundled TypeScript directly (`bun run src/index.ts`) currently
hits a Bun runtime bug: `@agentclientprotocol/sdk`'s peer dependency on `zod`
gets resolved against Bun's internal package-cache path rather than this
project's `node_modules`, and fails with `Cannot find module 'zod/v4'`.
Bundling with `bun build` (what `bun run start` / `bun run build` does)
inlines the resolved imports and avoids the bug. If you're iterating on the
source, use `bun run build && bun run dist/index.js` (or re-run `bun run
start`) to pick up changes — there is currently no separate unbundled dev
mode.

## Configuring an ACP client to spawn this plugin

Any ACP client (Zed, or a future generic ACP client in `../desktop`) should
be configured to spawn this project's built output and speak ACP over its
stdio, exactly as it would spawn `opencode acp` directly. For example, in
Zed's `~/.config/zed/settings.json`:

```json
"agent_servers": {
  "OpenCode (relay)": {
    "command": "bun",
    "args": ["run", "/path/to/opencode-agent/dist/index.js"]
  }
}
```

## Manually testing with the MVP ACP client

```bash
bun run client
```

`scripts/acp-client.ts` is a small interactive REPL that acts as a real ACP
*client* — it spawns this plugin's built relay exactly as a real client
would, completes `initialize`, and implements just enough client-side ACP
surface (real file read/write, a real terminal backed by `Bun.spawn`,
auto-approved permission requests) for OpenCode to actually do agentic work
through the relay, not just answer `initialize`. It streams `session/update`
text chunks straight to your terminal.

Commands once it's running:

```
new [cwd]                       # session/new (defaults cwd to this project)
list                            # session/list
prompt <sessionId> <text...>    # session/prompt
cancel <sessionId>              # session/cancel
close <sessionId>               # session/close
quit
```

This is a dev/testing tool, not part of the plugin's own runtime surface —
`elicitation/create` isn't implemented (returns an error) since it's rare and
still unstable in the ACP spec.

### Starting a chat

```
acp> new
{
  "sessionId": "ses_xxxxxxxx",
  ...
}
acp> prompt ses_xxxxxxxx 你好，帮我看看这个项目结构
```

`new` creates a session (defaults `cwd` to this project); note the
`sessionId` it returns. `prompt <sessionId> <text...>` sends a message on
that session — OpenCode's reply streams straight to your terminal as
`session/update` text chunks arrive. Keep sending `prompt` on the same
`sessionId` to continue the conversation; OpenCode manages the conversation
history itself.

A couple of things that can trip this up, unrelated to the relay itself:

- If OpenCode has no LLM provider configured, `prompt` will fail with an
  auth-related error. Run `bunx opencode auth login` from this project's
  directory (it uses the same pinned, local `opencode` binary) to configure
  one.
- Tool calls (file reads/writes, running commands) are auto-approved by the
  test client and actually executed for real — don't point `new`'s `cwd` at
  anything you don't want touched.

## Testing

```bash
bun test
```

Two test files:

- `src/relay.test.ts` — exhaustive protocol coverage. Wires the relay between
  two in-process fakes (a fake ACP client and a fake OpenCode agent, using
  `@agentclientprotocol/sdk`'s direct-connect support — no subprocess or real
  stdio) and asserts every ACP request/notification method the relay knows
  about (`AGENT_REQUEST_METHODS`, `AGENT_NOTIFICATION_METHODS`,
  `CLIENT_REQUEST_METHODS`, `CLIENT_NOTIFICATION_METHODS` in `src/relay.ts`)
  is forwarded unchanged in the correct direction, including that errors
  thrown downstream are relayed back as errors rather than swallowed. Fast,
  deterministic, no OpenCode process involved.
- `src/index.integration.test.ts` — smoke tests against the real, pinned
  `opencode acp` binary: a genuine `initialize` handshake + `session/new`,
  and confirming this plugin's own process exits when its `opencode acp`
  child crashes (this second test builds and spawns the real entrypoint as a
  subprocess, since the exit-propagation behavior lives in `index.ts`, not in
  `startRelay()` itself).

If a new ACP method is ever added to `src/relay.ts`'s method lists, it's
automatically covered by `relay.test.ts` without further changes — the test
suite iterates the same lists the relay uses to register handlers.

## Updating the pinned OpenCode version

`opencode-ai` is pinned to an exact version in `package.json` (not a semver
range), so the OpenCode binary this relay drives — and the ACP protocol
version it speaks — is deterministic. To pick up a new OpenCode release:

1. Bump the `opencode-ai` version in `package.json`.
2. Run `bun install`.
3. Re-run the manual verification (spawn this relay, complete an `initialize`
   handshake, exercise `session/new` / `session/prompt`) to confirm nothing in
   the ACP surface changed in a way that breaks the relay.
4. Commit the version bump and updated `bun.lock` as a normal, routine change.

## Scope of this plugin

This plugin only covers OpenCode, which already implements the ACP agent
role well. It deliberately does not include: an HTTP/WebSocket API, request
authentication (the transport is process stdio, not a network port),
logging/telemetry of ACP traffic, message interception ("seasoning") hooks,
compiling to a standalone single-file binary, or adapting any other agent
(Claude, in-house agents without full ACP support) into this plugin pattern.
See `openspec/changes/opencode-acp-wrapper/design.md` for the full rationale.
