#!/usr/bin/env bun
/**
 * MVP interactive ACP client for manually testing this repo's relay.
 *
 * Spawns the relay's built entrypoint (dist/index.js, building it first if
 * missing) as a child process — exactly how a real ACP client (Zed, or
 * Ora's future plugin manager) would — and drives it from a small REPL.
 * Implements just enough client-side ACP surface (fs read/write, a real
 * terminal backed by Bun.spawn, and auto-approved permission requests) for
 * OpenCode to actually be able to do agentic work through the relay, not
 * just answer `initialize`.
 *
 * This is a dev/testing tool, not part of the plugin's own runtime surface.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { client, ndJsonStream, RequestError, type ClientConnection } from "@agentclientprotocol/sdk";
import type { Subprocess } from "bun";
import { fileSinkToWritable } from "../src/stdio-stream.js";

type TerminalState = {
  proc: Subprocess<"ignore", "pipe", "pipe">;
  output: string;
  exitStatus: { exitCode: number | null; signal: string | null } | null;
};

async function main() {
  const projectRoot = new URL("..", import.meta.url).pathname;
  const builtEntry = `${projectRoot}dist/index.js`;
  if (!(await Bun.file(builtEntry).exists())) {
    console.error("Building the relay first (bun run build)...");
    const build = Bun.spawnSync(["bun", "build", "src/index.ts", "--target", "bun", "--outfile", "dist/index.js"], {
      cwd: projectRoot,
    });
    if (build.exitCode !== 0) {
      console.error(build.stderr.toString());
      process.exit(1);
    }
  }

  console.error(`Spawning relay under test: bun run ${builtEntry}`);
  const relayProcess = Bun.spawn(["bun", "run", builtEntry], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  relayProcess.exited.then((code) => {
    console.error(`\n[relay process exited with code ${code}]`);
    process.exit(0);
  });

  const stream = ndJsonStream(fileSinkToWritable(relayProcess.stdin), relayProcess.stdout);

  const terminals = new Map<string, TerminalState>();

  const app = client({ name: "acp-mvp-test-client" })
    .onNotification("session/update", (p) => p, (ctx) => {
      printUpdate(ctx.params as Record<string, unknown>);
    })
    .onRequest("session/request_permission", (p) => p, (ctx) => {
      const params = ctx.params as {
        toolCall: { title?: string; kind?: string };
        options: { optionId: string; name: string; kind: string }[];
      };
      const chosen =
        params.options.find((o) => o.kind === "allow_once" || o.kind === "allow_always") ?? params.options[0];
      console.error(
        `\n[permission requested] ${params.toolCall.title ?? params.toolCall.kind ?? "tool call"} -> auto-choosing "${chosen?.name}"`,
      );
      if (!chosen) {
        return { outcome: { outcome: "cancelled" } };
      }
      return { outcome: { outcome: "selected", optionId: chosen.optionId } };
    })
    .onRequest("fs/read_text_file", (p) => p, async (ctx) => {
      const params = ctx.params as { path: string; line?: number | null; limit?: number | null };
      const content = await readFile(params.path, "utf8");
      if (params.line == null && params.limit == null) {
        return { content };
      }
      const lines = content.split("\n");
      const start = (params.line ?? 1) - 1;
      const end = params.limit != null ? start + params.limit : undefined;
      return { content: lines.slice(start, end).join("\n") };
    })
    .onRequest("fs/write_text_file", (p) => p, async (ctx) => {
      const params = ctx.params as { path: string; content: string };
      await writeFile(params.path, params.content, "utf8");
      return {};
    })
    .onRequest("terminal/create", (p) => p, (ctx) => {
      const params = ctx.params as {
        command: string;
        args?: string[];
        cwd?: string | null;
        env?: { name: string; value: string }[];
      };
      const terminalId = crypto.randomUUID();
      const env = { ...process.env };
      for (const e of params.env ?? []) env[e.name] = e.value;
      const proc = Bun.spawn([params.command, ...(params.args ?? [])], {
        cwd: params.cwd ?? undefined,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const state: TerminalState = { proc, output: "", exitStatus: null };
      terminals.set(terminalId, state);
      pumpTerminalOutput(state);
      proc.exited.then((exitCode) => {
        state.exitStatus = { exitCode, signal: null };
      });
      return { terminalId };
    })
    .onRequest("terminal/output", (p) => p, (ctx) => {
      const params = ctx.params as { terminalId: string };
      const state = terminals.get(params.terminalId);
      if (!state) throw RequestError.resourceNotFound(params.terminalId);
      return { output: state.output, truncated: false, exitStatus: state.exitStatus };
    })
    .onRequest("terminal/wait_for_exit", (p) => p, async (ctx) => {
      const params = ctx.params as { terminalId: string };
      const state = terminals.get(params.terminalId);
      if (!state) throw RequestError.resourceNotFound(params.terminalId);
      const exitCode = await state.proc.exited;
      return { exitCode, signal: null };
    })
    .onRequest("terminal/kill", (p) => p, (ctx) => {
      const params = ctx.params as { terminalId: string };
      terminals.get(params.terminalId)?.proc.kill();
      return {};
    })
    .onRequest("terminal/release", (p) => p, (ctx) => {
      const params = ctx.params as { terminalId: string };
      const state = terminals.get(params.terminalId);
      state?.proc.kill();
      terminals.delete(params.terminalId);
      return {};
    })
    .onRequest("elicitation/create", (p) => p, () => {
      throw RequestError.methodNotFound("elicitation/create (not supported by this MVP test client)");
    });

  const connection: ClientConnection = app.connect(stream);

  console.error("Sending initialize...");
  const initResult = await connection.agent.request<unknown, unknown>("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
  });
  console.error("initialize ->", JSON.stringify(initResult, null, 2));

  await repl(connection);
  relayProcess.kill();
}

async function pumpTerminalOutput(state: TerminalState) {
  for (const stream of [state.proc.stdout, state.proc.stderr]) {
    (async () => {
      for await (const chunk of stream as ReadableStream<Uint8Array>) {
        state.output += new TextDecoder().decode(chunk);
      }
    })();
  }
}

function printUpdate(params: Record<string, unknown>) {
  const update = params.update as Record<string, unknown> | undefined;
  const kind = update?.sessionUpdate;
  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    const content = update?.content as { type?: string; text?: string } | undefined;
    if (content?.type === "text") {
      process.stdout.write(content.text ?? "");
      return;
    }
  }
  console.error(`\n[session/update] ${JSON.stringify(params)}`);
}

async function repl(connection: ClientConnection) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.error(
    "\nCommands: new [cwd] | list | prompt <sessionId> <text...> | cancel <sessionId> | close <sessionId> | quit\n",
  );
  for (;;) {
    let line: string;
    try {
      line = (await rl.question("acp> ")).trim();
    } catch (error) {
      if (error instanceof Error && error.message.includes("readline was closed")) break;
      throw error;
    }
    if (!line) continue;
    const [cmd, ...rest] = line.split(/\s+/);
    try {
      if (cmd === "quit" || cmd === "exit") break;
      if (cmd === "new") {
        const cwd = rest[0] ?? process.cwd();
        const result = await connection.agent.request<unknown, unknown>("session/new", { cwd, mcpServers: [] });
        console.log(JSON.stringify(result, null, 2));
      } else if (cmd === "list") {
        const result = await connection.agent.request<unknown, unknown>("session/list", {});
        console.log(JSON.stringify(result, null, 2));
      } else if (cmd === "prompt") {
        const [sessionId, ...text] = rest;
        const result = await connection.agent.request<unknown, unknown>("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: text.join(" ") }],
        });
        console.log(`\n[prompt result] ${JSON.stringify(result)}`);
      } else if (cmd === "cancel") {
        await connection.agent.notify("session/cancel", { sessionId: rest[0] });
      } else if (cmd === "close") {
        const result = await connection.agent.request<unknown, unknown>("session/close", { sessionId: rest[0] });
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.error(`unknown command: ${cmd}`);
      }
    } catch (error) {
      console.error("error:", error);
    }
  }
  rl.close();
}

main();
