## 1. Project Setup

- [x] 1.1 Initialize Bun/TypeScript project (package.json, tsconfig, lint/format config) in this repo
- [x] 1.2 Add `opencode-ai` as a version-pinned dependency and `@agentclientprotocol/sdk` as a dependency
- [x] 1.3 Implement resolution of the `opencode` executable path from this project's own installed dependencies (e.g. `node_modules/.bin/opencode`)

## 2. Downward Client Role (toward OpenCode)

- [x] 2.1 Spawn the resolved `opencode` binary with the `acp` subcommand as a child process at startup
- [x] 2.2 Wire a `@agentclientprotocol/sdk` `client({ name })` instance to the child process's stdin/stdout and complete the ACP `initialize` handshake against it
- [x] 2.3 Implement child process exit/crash handling: this process exits when the child exits, for any reason

## 3. Upward Agent Role (toward whatever spawns this process)

- [x] 3.1 Wire a `@agentclientprotocol/sdk` `agent({ name })` instance to this process's own stdin/stdout
- [x] 3.2 Implement the `initialize` handler, responding as a standards-compliant ACP agent
- [x] 3.3 Implement `session/new`, `session/prompt`, and cancellation handlers, each forwarding through the downward client role to OpenCode and returning its result unchanged

## 4. Bidirectional Relay

- [x] 4.1 Relay `session/update` notifications from the downward client role upward to the corresponding upward session, unchanged
- [x] 4.2 Relay `session/request_permission` requests from the downward client role upward, and relay the upward response back down, unchanged
- [x] 4.3 Verify no ACP method or notification is silently dropped by exercising the full set of methods `opencode acp` is known to send/receive

## 5. Manual Verification

- [x] 5.1 Manually exercise this process end-to-end using an existing ACP client (e.g. Zed configured to spawn this project instead of `opencode acp` directly), confirming a real coding session works through the relay
- [x] 5.2 Confirm that killing/crashing the `opencode acp` child process causes this process to exit and the upward ACP client observes an ordinary agent-process-exit condition

## 6. Documentation

- [x] 6.1 Document how to run this project (`bun install`, `bun run`) and how an ACP client should be configured to spawn it
- [x] 6.2 Document the pinned `opencode-ai` version and the process for bumping it

## 7. Automated Tests

- [x] 7.1 Refactor `startRelay` to accept generic ACP connect targets (`Stream | ClientApp` upward, `Stream | AgentApp` downward) so it can be exercised in-process without a real subprocess, using `@agentclientprotocol/sdk`'s direct agent-to-client connect support
- [x] 7.2 Export the relay's method lists (`AGENT_REQUEST_METHODS`, `AGENT_NOTIFICATION_METHODS`, `CLIENT_REQUEST_METHODS`, `CLIENT_NOTIFICATION_METHODS`) so tests iterate the same lists the relay registers handlers from
- [x] 7.3 Write `bun test` coverage exercising every method in all four lists bidirectionally against in-process fakes, asserting exact, unmodified forwarding in both directions, plus that downstream errors are relayed as errors
- [x] 7.4 Write an integration test against the real, pinned `opencode acp` binary covering a genuine `initialize` handshake and `session/new`
- [x] 7.5 Write an integration test confirming this plugin's own process (the real built entrypoint, not `startRelay()` in isolation) exits when its `opencode acp` child crashes
