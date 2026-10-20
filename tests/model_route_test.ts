import { assertEquals, assertRejects } from "@std/assert";
import { type AgentModelContext, INVALID_PARAMS } from "@ora-space/plugin-sdk";
import { startOpenCode } from "../src/handlers/lifecycle.ts";
import { modelRoute } from "../src/services/model-route.ts";
import {
  OpenCodeClient,
  type SpawnedProcess,
} from "../src/services/opencode-client.ts";

const TOKEN = "synthetic-temporary-token";
const CONFIG = "/session/home/.config";

/** The frozen context a Node hands this plugin for one platform-model execution. */
function context(
  overrides: Partial<AgentModelContext["configuration"]> = {},
): AgentModelContext {
  return {
    configuration: {
      pluginId: "official/ora-space.opencode",
      pluginVersion: "0.7.0",
      target: "x86_64-unknown-linux-gnu",
      packageSha256: "a".repeat(64),
      schemaVersion: 2,
      declarationFingerprint: "b".repeat(64),
      adapterVersion: 1,
      configurationRevision: 3,
      settingsJson: "{}",
      protocol: "openai-completions",
      model: {
        id: "team/model",
        name: "Team model",
        contextWindow: 32768,
        maxTokens: 1024,
      },
      ...overrides,
    },
    proxyBaseUrl: "https://gateway.internal/runtime/openai/v1",
    token: TOKEN,
  };
}

Deno.test("the frozen model becomes the one OpenCode provider the Node used to write", () => {
  const route = modelRoute(context(), CONFIG);
  assertEquals(route.applied, {
    adapterVersion: 1,
    declarationFingerprint: "b".repeat(64),
    configurationRevision: 3,
  });
  const { OPENCODE_CONFIG_CONTENT, ...environment } = route.environment;
  assertEquals(environment, {
    ORA_MODEL_ACCESS_TOKEN: TOKEN,
    OPENCODE_CONFIG_DIR: CONFIG,
    OPENCODE_DISABLE_PROJECT_CONFIG: "true",
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
  });
  assertEquals(JSON.parse(OPENCODE_CONFIG_CONTENT), {
    $schema: "https://opencode.ai/config.json",
    model: "ora-model/team/model",
    small_model: "ora-model/team/model",
    enabled_providers: ["ora-model"],
    provider: {
      "ora-model": {
        npm: "@ai-sdk/openai-compatible",
        name: "Ora model gateway",
        options: {
          baseURL: "https://gateway.internal/runtime/openai/v1",
          apiKey: "{env:ORA_MODEL_ACCESS_TOKEN}",
        },
        models: {
          "team/model": {
            name: "Team model",
            limit: { context: 32768, output: 1024 },
          },
        },
      },
    },
  });
  // The configuration text names the variable, so serializing it never persists the token.
  assertEquals(OPENCODE_CONFIG_CONTENT.includes(TOKEN), false);
});

Deno.test("Anthropic Messages selects the bundled Anthropic provider", () => {
  const route = modelRoute(
    context({ protocol: "anthropic-messages" }),
    CONFIG,
  );
  assertEquals(
    JSON.parse(route.environment.OPENCODE_CONFIG_CONTENT).provider["ora-model"]
      .npm,
    "@ai-sdk/anthropic",
  );
});

Deno.test("configurations this release cannot apply are refused without echoing the token", () => {
  const cases: [AgentModelContext, string][] = [
    [context({ settingsJson: '{"model":"other"}' }), CONFIG],
    [context({ settingsJson: "[]" }), CONFIG],
    [{ ...context(), proxyBaseUrl: "http://gateway.internal/v1" }, CONFIG],
    [{ ...context(), proxyBaseUrl: "https://u:p@gateway.internal/v1" }, CONFIG],
    [context(), ""],
  ];
  for (const [input, directory] of cases) {
    let caught: unknown;
    try {
      modelRoute(input, directory);
    } catch (error) {
      caught = error;
    }
    assertEquals((caught as { code?: number }).code, INVALID_PARAMS);
    assertEquals(String((caught as Error).message).includes(TOKEN), false);
  }
});

Deno.test("a platform start runs the CLI with its route and confirms it, and a restart keeps it", async () => {
  const environments: Record<string, string>[] = [];
  const client = new OpenCodeClient({
    spawn: (_args, _cwd, env) => {
      environments.push(env);
      return silentProcess();
    },
  });
  const applied = await startOpenCode(client, {
    cwd: "/workspace",
    hostVersion: "1.0.0",
    modelContext: context(),
  }, CONFIG);
  assertEquals(applied, modelRoute(context(), CONFIG).applied);
  await client.start("/workspace");
  assertEquals(environments, [
    { ...modelRoute(context(), CONFIG).environment },
    { ...modelRoute(context(), CONFIG).environment },
  ]);
  await client.stop();
});

Deno.test("a local start keeps the CLI's own configuration and confirms nothing", async () => {
  const environments: Record<string, string>[] = [];
  const client = new OpenCodeClient({
    spawn: (_args, _cwd, env) => {
      environments.push(env);
      return silentProcess();
    },
  });
  const applied = await startOpenCode(client, {
    cwd: "/workspace",
    hostVersion: "1.0.0",
  }, undefined);
  assertEquals(environments, [{}]);
  assertEquals(applied, undefined);
  await client.stop();
});

Deno.test("a platform start without a private configuration root is refused before spawning", async () => {
  let spawned = 0;
  const client = new OpenCodeClient({
    spawn: () => {
      spawned += 1;
      return silentProcess();
    },
  });
  const error = await assertRejects(() =>
    startOpenCode(client, {
      cwd: "/workspace",
      hostVersion: "1.0.0",
      modelContext: context(),
    }, undefined)
  );
  assertEquals((error as { code?: number }).code, INVALID_PARAMS);
  assertEquals(spawned, 0);
});

/** A `SpawnedProcess` that never speaks and ends when killed. */
function silentProcess(): SpawnedProcess {
  let ended: (() => void) | undefined;
  let stdout: ReadableStreamDefaultController<Uint8Array> | undefined;
  return {
    pid: 4321,
    stdin: new WritableStream<Uint8Array>(),
    stdout: new ReadableStream({
      start: (controller) => {
        stdout = controller;
      },
    }),
    stderr: new ReadableStream({ start: (controller) => controller.close() }),
    exited: new Promise((resolve) => {
      ended = () => resolve();
    }),
    kill: () => {
      stdout?.close();
      ended?.();
    },
  };
}
