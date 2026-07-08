## ADDED Requirements

### Requirement: Present as an ACP agent upward
The system SHALL expose an ACP agent role (via `@agentclientprotocol/sdk`'s `agent({ name })`) over its own stdin/stdout, so that any ACP client that spawns this process can complete the ACP `initialize` handshake and issue session methods against it exactly as it would against any other ACP-compliant agent.

#### Scenario: A generic ACP client spawns this process
- **WHEN** an ACP client spawns this process and sends an `initialize` request over its stdin
- **THEN** the system responds as a standards-compliant ACP agent, without requiring the caller to know that OpenCode is running behind it

### Requirement: Drive a real OpenCode agent downward
The system SHALL spawn the project's pinned `opencode acp` binary as a child process and communicate with it as an ACP client role (via `@agentclientprotocol/sdk`'s `client({ name })`) over that child's stdin/stdout.

#### Scenario: Startup spawns the child agent
- **WHEN** this process starts
- **THEN** it spawns `opencode acp` as a child process and completes the ACP `initialize` handshake with it before accepting upward requests that require a working child connection

### Requirement: Transparently relay ACP calls and notifications
The system SHALL forward every ACP method call and notification received on its upward (agent) role through to the downward (client) role against the real OpenCode agent, and forward every response and notification received from OpenCode back upward, without altering the semantic content of the message.

#### Scenario: Session creation is relayed
- **WHEN** the upward caller issues `session/new`
- **THEN** the system issues the equivalent `session/new` call to the underlying OpenCode agent and returns OpenCode's response upward unchanged

#### Scenario: Session updates are relayed
- **WHEN** the underlying OpenCode agent emits a `session/update` notification for an active session
- **THEN** the system forwards that notification upward to the caller unchanged

#### Scenario: Permission requests are relayed
- **WHEN** the underlying OpenCode agent issues a `session/request_permission` request
- **THEN** the system forwards that request upward as-is and relays the upward caller's response back to OpenCode unchanged, without interpreting or altering the decision
