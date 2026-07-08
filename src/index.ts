import { ndJsonStream } from "@agentclientprotocol/sdk";
import { resolveOpencodeBinary } from "./opencode-binary.js";
import { startRelay } from "./relay.js";
import { fileSinkToWritable } from "./stdio-stream.js";

const opencodeBin = resolveOpencodeBinary();

const opencodeProcess = Bun.spawn([opencodeBin, "acp"], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
});

// Propagate the child's lifecycle as our own: if `opencode acp` exits, for
// any reason, this process exits too, so whatever spawned us observes an
// ordinary "agent process ended" condition rather than a custom signal.
opencodeProcess.exited.then((exitCode) => {
  process.exit(exitCode ?? 1);
});

const downStream = ndJsonStream(fileSinkToWritable(opencodeProcess.stdin), opencodeProcess.stdout);
const upStream = ndJsonStream(fileSinkToWritable(Bun.stdout.writer()), Bun.stdin.stream());

startRelay(upStream, downStream);
