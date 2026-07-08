import { afterEach, describe, expect, test } from "bun:test";
import { client, ndJsonStream, type ClientApp } from "@agentclientprotocol/sdk";
import type { Subprocess } from "bun";
import { resolveOpencodeBinary } from "./opencode-binary.js";
import { startRelay } from "./relay.js";
import { fileSinkToWritable } from "./stdio-stream.js";

/**
 * Exercises the relay against the real, pinned `opencode acp` binary (not a
 * fake), as a smoke test that the wiring in `index.ts` actually works
 * end-to-end. `relay.test.ts` covers full protocol-method coverage against
 * in-process fakes; this file covers "does it work against the real thing".
 */
describe("relay against the real opencode acp process", () => {
  let opencodeProcess: Subprocess<"pipe", "pipe", "inherit"> | undefined;
  let relayProcess: Subprocess<"pipe", "pipe", "inherit"> | undefined;

  afterEach(() => {
    opencodeProcess?.kill();
    opencodeProcess = undefined;
    relayProcess?.kill();
    relayProcess = undefined;
  });

  test("completes a real initialize handshake and creates a session", async () => {
    const opencodeBin = resolveOpencodeBinary();
    opencodeProcess = Bun.spawn([opencodeBin, "acp"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });

    const downStream = ndJsonStream(fileSinkToWritable(opencodeProcess.stdin), opencodeProcess.stdout);

    let fakeCallerConnection: ReturnType<ClientApp["connect"]> | undefined;
    const fakeCaller = client({ name: "integration-test-caller" }).onConnect((conn) => {
      fakeCallerConnection = conn;
    });
    startRelay(fakeCaller, downStream);
    expect(fakeCallerConnection).toBeDefined();

    const initializeResult = await fakeCallerConnection!.agent.request<unknown, unknown>("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
    });
    expect(initializeResult).toMatchObject({
      protocolVersion: 1,
      agentInfo: { name: "OpenCode" },
    });

    const newSessionResult = (await fakeCallerConnection!.agent.request<unknown, unknown>("session/new", {
      cwd: process.cwd(),
      mcpServers: [],
    })) as { sessionId: string };
    expect(typeof newSessionResult.sessionId).toBe("string");
    expect(newSessionResult.sessionId.length).toBeGreaterThan(0);
  }, 20_000);

  test("this plugin's own process exits when its opencode acp child crashes", async () => {
    // Exercises the real entrypoint (index.ts), not startRelay() directly,
    // since the child-exit-propagates-to-self behavior is wired in index.ts.
    // Unbundled `bun run` hits a known Bun/zod resolution bug (see
    // design.md), so this drives the built output, building it first if
    // needed.
    const projectRoot = new URL("..", import.meta.url).pathname;
    const builtEntry = `${projectRoot}dist/index.js`;
    if (!(await Bun.file(builtEntry).exists())) {
      const build = Bun.spawnSync(["bun", "build", "src/index.ts", "--target", "bun", "--outfile", "dist/index.js"], {
        cwd: projectRoot,
      });
      expect(build.exitCode).toBe(0);
    }

    relayProcess = Bun.spawn(["bun", "run", builtEntry], {
      cwd: projectRoot,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });

    // Give it a moment to spawn its own opencode acp child before we look for it.
    await Bun.sleep(1500);

    const psOutput = Bun.spawnSync(["ps", "-eo", "pid,ppid,args"]).stdout.toString();
    const childLine = psOutput
      .split("\n")
      .find((line) => line.includes(`${relayProcess!.pid} `) && line.includes("opencode") && line.includes("acp"));
    expect(childLine).toBeDefined();
    const childPid = Number(childLine!.trim().split(/\s+/)[0]);

    process.kill(childPid, "SIGKILL");

    const relayExitCode = await Promise.race([relayProcess.exited, Bun.sleep(5000).then(() => "timeout" as const)]);

    expect(relayExitCode).not.toBe("timeout");
  }, 20_000);
});
