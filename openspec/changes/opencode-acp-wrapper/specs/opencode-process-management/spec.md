## ADDED Requirements

### Requirement: Resolve OpenCode from a pinned project dependency
The system SHALL depend on `opencode-ai` as a version-pinned dependency of this project and SHALL resolve the `opencode` executable from this project's own installed dependencies, without searching the host's `PATH` or requiring a separately, globally installed OpenCode.

#### Scenario: Dependencies are installed
- **WHEN** this project's dependencies have been installed (e.g. via `bun install`)
- **THEN** the system resolves the `opencode` executable from its own `node_modules` and uses that exact resolved binary to spawn `opencode acp`

### Requirement: Spawn the OpenCode ACP agent
The system SHALL spawn the resolved `opencode` executable with the `acp` subcommand as a child process when this process starts, connecting to its stdin/stdout for ACP communication.

#### Scenario: Successful spawn
- **WHEN** the resolved `opencode` binary is spawned with the `acp` subcommand
- **THEN** the system establishes ACP communication with it over that child process's stdio before treating itself as ready

### Requirement: Propagate child process lifecycle
The system SHALL exit when its `opencode acp` child process exits, for any reason (normal exit or crash), rather than continuing to run or emitting a custom error signal in its place.

#### Scenario: Child process crashes
- **WHEN** the `opencode acp` child process exits unexpectedly
- **THEN** this process also exits, so that whatever spawned this process observes an ordinary process-exit condition

#### Scenario: Child process exits normally
- **WHEN** the `opencode acp` child process exits normally (e.g. terminated deliberately)
- **THEN** this process exits as well, mirroring the child's exit
