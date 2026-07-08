import { describe, expect, test } from "bun:test";
import { agent, client, type AgentApp, type ClientApp } from "@agentclientprotocol/sdk";
import {
  AGENT_NOTIFICATION_METHODS,
  AGENT_REQUEST_METHODS,
  CLIENT_NOTIFICATION_METHODS,
  CLIENT_REQUEST_METHODS,
  startRelay,
} from "./relay.js";

/** Identity parser: accepts any raw params without validating against a real ACP schema. */
const passthrough = (params: unknown) => params;

/**
 * Fixture params for a given method. Most methods accept an arbitrary probe
 * payload since the relay never reinterprets content either way — but the
 * SDK validates a few outgoing built-in notifications (e.g. `session/update`)
 * against their real schema before sending, so those need a minimally
 * valid-shaped payload instead.
 */
function fixtureParams(method: string): unknown {
  if (method === "session/update") {
    return {
      sessionId: "probe-session",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "probe" } },
    };
  }
  return { probe: method };
}

describe("ACP relay: full protocol coverage", () => {
  describe("agent request methods (forwarded downward, response relayed back unchanged)", () => {
    for (const method of AGENT_REQUEST_METHODS) {
      test(method, async () => {
        const fakeCaller = client({ name: "fake-caller" });
        let fakeCallerConnection: ReturnType<ClientApp["connect"]> | undefined;
        fakeCaller.onConnect((conn) => {
          fakeCallerConnection = conn;
        });

        const fakeOpencode = agent({ name: "fake-opencode" });
        let received: unknown;
        fakeOpencode.onRequest(method, passthrough, (ctx) => {
          received = ctx.params;
          return { echoed: method, params: ctx.params };
        });

        startRelay(fakeCaller, fakeOpencode);
        expect(fakeCallerConnection).toBeDefined();

        const params = fixtureParams(method);
        const result = await fakeCallerConnection!.agent.request<unknown, unknown>(method, params);

        expect(received).toEqual(params);
        expect(result).toEqual({ echoed: method, params });
      });
    }
  });

  describe("agent notification methods (forwarded downward unchanged)", () => {
    for (const method of AGENT_NOTIFICATION_METHODS) {
      test(method, async () => {
        const fakeCaller = client({ name: "fake-caller" });
        let fakeCallerConnection: ReturnType<ClientApp["connect"]> | undefined;
        fakeCaller.onConnect((conn) => {
          fakeCallerConnection = conn;
        });

        const fakeOpencode = agent({ name: "fake-opencode" });
        let resolveReceived: (params: unknown) => void;
        const received = new Promise<unknown>((resolve) => {
          resolveReceived = resolve;
        });
        fakeOpencode.onNotification(method, passthrough, (ctx) => {
          resolveReceived(ctx.params);
        });

        startRelay(fakeCaller, fakeOpencode);
        expect(fakeCallerConnection).toBeDefined();

        const params = fixtureParams(method);
        await fakeCallerConnection!.agent.notify<unknown>(method, params);

        expect(await received).toEqual(params);
      });
    }
  });

  describe("client request methods (forwarded upward, response relayed back unchanged)", () => {
    for (const method of CLIENT_REQUEST_METHODS) {
      test(method, async () => {
        let fakeCallerReceived: unknown;
        const fakeCaller = client({ name: "fake-caller" }).onRequest(method, passthrough, (ctx) => {
          fakeCallerReceived = ctx.params;
          return { echoed: method, params: ctx.params };
        });

        const fakeOpencode = agent({ name: "fake-opencode" });
        let fakeOpencodeConnection: ReturnType<AgentApp["connect"]> | undefined;
        fakeOpencode.onConnect((conn) => {
          fakeOpencodeConnection = conn;
        });

        startRelay(fakeCaller, fakeOpencode);
        expect(fakeOpencodeConnection).toBeDefined();

        const params = fixtureParams(method);
        const result = await fakeOpencodeConnection!.client.request<unknown, unknown>(method, params);

        expect(fakeCallerReceived).toEqual(params);
        expect(result).toEqual({ echoed: method, params });
      });
    }
  });

  describe("client notification methods (forwarded upward unchanged)", () => {
    for (const method of CLIENT_NOTIFICATION_METHODS) {
      test(method, async () => {
        let resolveReceived: (params: unknown) => void;
        const received = new Promise<unknown>((resolve) => {
          resolveReceived = resolve;
        });
        const fakeCaller = client({ name: "fake-caller" }).onNotification(method, passthrough, (ctx) => {
          resolveReceived(ctx.params);
        });

        const fakeOpencode = agent({ name: "fake-opencode" });
        let fakeOpencodeConnection: ReturnType<AgentApp["connect"]> | undefined;
        fakeOpencode.onConnect((conn) => {
          fakeOpencodeConnection = conn;
        });

        startRelay(fakeCaller, fakeOpencode);
        expect(fakeOpencodeConnection).toBeDefined();

        const params = fixtureParams(method);
        await fakeOpencodeConnection!.client.notify<unknown>(method, params);

        expect(await received).toEqual(params);
      });
    }
  });

  test("agent request errors from downstream are relayed back as errors, not swallowed", async () => {
    const fakeCaller = client({ name: "fake-caller" });
    let fakeCallerConnection: ReturnType<ClientApp["connect"]> | undefined;
    fakeCaller.onConnect((conn) => {
      fakeCallerConnection = conn;
    });

    const fakeOpencode = agent({ name: "fake-opencode" }).onRequest("session/new", passthrough, () => {
      throw new Error("boom");
    });

    startRelay(fakeCaller, fakeOpencode);

    await expect(fakeCallerConnection!.agent.request<unknown, unknown>("session/new", {})).rejects.toBeDefined();
  });
});
