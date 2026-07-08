import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the `opencode` executable from this project's own installed
 * dependencies (`node_modules/.bin/opencode`), rather than searching the
 * host's PATH. `opencode-ai` is a pinned dependency of this project (see
 * package.json), so the resolved binary's version is deterministic.
 */
export function resolveOpencodeBinary(): string {
  const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
  const binPath = join(projectRoot, "node_modules", ".bin", "opencode");

  if (!existsSync(binPath)) {
    throw new Error(
      `Could not find the "opencode" executable at ${binPath}. ` +
        `Make sure dependencies are installed (run "bun install"); ` +
        `this project depends on "opencode-ai" for its bundled OpenCode binary.`,
    );
  }

  return binPath;
}

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate project root (package.json) starting from ${startDir}`);
    }
    dir = parent;
  }
}
