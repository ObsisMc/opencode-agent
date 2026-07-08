import {
  agent,
  client,
  type AgentApp,
  type AgentConnection,
  type ClientApp,
  type ClientConnection,
  type SendRequestOptions,
  type Stream,
} from "@agentclientprotocol/sdk";

/** ACP methods answered on the agent role (upward), forwarded down to OpenCode as agent-side calls. */
export const AGENT_REQUEST_METHODS = [
  "initialize",
  "session/new",
  "session/load",
  "session/fork",
  "session/list",
  "session/delete",
  "session/resume",
  "session/close",
  "session/set_mode",
  "session/set_config_option",
  "authenticate",
  "providers/list",
  "providers/set",
  "providers/disable",
  "logout",
  "session/prompt",
  "nes/start",
  "nes/suggest",
  "nes/close",
] as const;

/** ACP notifications received on the agent role (upward), forwarded down to OpenCode. */
export const AGENT_NOTIFICATION_METHODS = [
  "session/cancel",
  "document/didOpen",
  "document/didChange",
  "document/didClose",
  "document/didSave",
  "document/didFocus",
  "nes/accept",
  "nes/reject",
] as const;

/** ACP methods OpenCode calls on the client role (downward), forwarded up to the real caller. */
export const CLIENT_REQUEST_METHODS = [
  "session/request_permission",
  "fs/write_text_file",
  "fs/read_text_file",
  "terminal/create",
  "terminal/output",
  "terminal/release",
  "terminal/wait_for_exit",
  "terminal/kill",
  "elicitation/create",
] as const;

/** ACP notifications OpenCode sends on the client role (downward), forwarded up to the real caller. */
export const CLIENT_NOTIFICATION_METHODS = ["session/update", "elicitation/complete"] as const;

/** Identity parser: passes raw JSON-RPC params through unchanged, with no reinterpretation. */
const passthrough = (params: unknown) => params;

/**
 * Starts the ACP relay: presents `upward` as an ACP agent (a `Stream` for the
 * real stdio case, or a `ClientApp` for in-process testing), while driving
 * `downward` as an ACP agent via the client role (a `Stream` wrapping the
 * OpenCode child process's stdio in production, or an `AgentApp` for
 * in-process testing), forwarding every call/notification unchanged in both
 * directions.
 */
export function startRelay(
  upward: Stream | ClientApp,
  downward: Stream | AgentApp,
): {
  agentConnection: AgentConnection;
  clientConnection: ClientConnection;
} {
  let agentConnection: AgentConnection | undefined;
  let clientConnection: ClientConnection | undefined;

  const requestOptions = (signal: AbortSignal): SendRequestOptions => ({
    cancellationSignal: signal,
  });

  const clientApp = client({ name: "opencode-agent-relay" });
  for (const method of CLIENT_REQUEST_METHODS) {
    clientApp.onRequest(method, passthrough, (ctx) => {
      if (!agentConnection) {
        throw new Error(`Received "${method}" from OpenCode before the upward ACP connection was ready`);
      }
      return agentConnection.client.request(method, ctx.params, requestOptions(ctx.signal));
    });
  }
  for (const method of CLIENT_NOTIFICATION_METHODS) {
    clientApp.onNotification(method, passthrough, (ctx) => {
      if (!agentConnection) {
        throw new Error(`Received "${method}" from OpenCode before the upward ACP connection was ready`);
      }
      return agentConnection.client.notify(method, ctx.params);
    });
  }

  const agentApp = agent({ name: "opencode-agent-relay" });
  for (const method of AGENT_REQUEST_METHODS) {
    agentApp.onRequest(method, passthrough, (ctx) => {
      if (!clientConnection) {
        throw new Error(`Received "${method}" before the downward OpenCode connection was ready`);
      }
      return clientConnection.agent.request(method, ctx.params, requestOptions(ctx.signal));
    });
  }
  for (const method of AGENT_NOTIFICATION_METHODS) {
    agentApp.onNotification(method, passthrough, (ctx) => {
      if (!clientConnection) {
        throw new Error(`Received "${method}" before the downward OpenCode connection was ready`);
      }
      return clientConnection.agent.notify(method, ctx.params);
    });
  }

  clientConnection = isStream(downward) ? clientApp.connect(downward) : clientApp.connect(downward);
  agentConnection = isStream(upward) ? agentApp.connect(upward) : agentApp.connect(upward);

  return { agentConnection, clientConnection };
}

/** Narrows a connect target to a raw `Stream`, as opposed to an in-process `AgentApp`/`ClientApp`. */
function isStream(target: Stream | AgentApp | ClientApp): target is Stream {
  return typeof target === "object" && target !== null && "readable" in target && "writable" in target;
}
