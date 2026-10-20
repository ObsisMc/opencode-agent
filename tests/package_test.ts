import { assertEquals, assertRejects } from "@std/assert";
import { BlobReader, ZipWriter } from "@zip-js/zip-js";
import {
  declarationAssociation,
  packagedDeclaration,
  releaseManifest,
} from "../scripts/package.ts";

const DECLARATION_SHA256 =
  "f1186c1e0f210b3a1c9d4db7b4929183313288d97246e4d5088a342a02defc49";

const encode = (text: string) => new TextEncoder().encode(text);

Deno.test("the shipped declaration is the pinned single-model shape over both protocols", async () => {
  const bytes = await Deno.readFile(
    new URL("../assets/config.json", import.meta.url),
  );
  assertEquals(JSON.parse(new TextDecoder().decode(bytes)), {
    schemaVersion: 2,
    agent: {
      modelAccess: {
        contractVersion: 1,
        protocols: ["openai-completions", "anthropic-messages"],
        modelCardinality: "single",
      },
    },
  });
  // The digest is the declaration's published identity: reformatting the file is a
  // release-affecting change this test exists to make someone notice.
  assertEquals(await declarationAssociation(bytes), {
    schemaVersion: 2,
    declarationSha256: DECLARATION_SHA256,
    copy: "agent-configuration.json",
  });
});

Deno.test("packagedDeclaration reads bound bytes back, and reports their absence", async () => {
  const declaration = encode('{"schemaVersion":2}');
  const writePackage = async (entries: [string, Uint8Array][]) => {
    const path = await Deno.makeTempFile();
    const file = await Deno.open(path, { write: true, truncate: true });
    const writer = new ZipWriter(file.writable);
    for (const [name, bytes] of entries) {
      await writer.add(
        name,
        new BlobReader(new Blob([bytes as Uint8Array<ArrayBuffer>])),
      );
    }
    await writer.close();
    return path;
  };
  const bound = await writePackage([
    ["orax.toml", encode("resolver = 1")],
    ["assets/config.json", declaration],
  ]);
  const unbound = await writePackage([["orax.toml", encode("resolver = 1")]]);
  try {
    assertEquals(await packagedDeclaration(bound), declaration);
    assertEquals(await packagedDeclaration(unbound), undefined);
  } finally {
    await Deno.remove(bound);
    await Deno.remove(unbound);
  }
});

Deno.test("a declaration no host compiler would accept cannot be bound", async () => {
  for (
    const bytes of [
      encode("not json"),
      encode('{"agent":{}}'),
      encode('{"schemaVersion":0}'),
      new Uint8Array(256 * 1024 + 1),
    ]
  ) {
    await assertRejects(() => declarationAssociation(bytes), Error);
  }
});

Deno.test("without a declaration the manifest renders exactly as before", () => {
  const installed = 'resolver = 1\nidentifier = "ora-space.opencode"\n';
  assertEquals(
    releaseManifest(installed, {
      kind: "targets",
      targets: [{
        triple: "x86_64-unknown-linux-gnu",
        url: "https://example.invalid/a.orax",
        sha256: "aa",
      }],
    }),
    `resolver = 1
identifier = "ora-space.opencode"

[[targets]]
target = "x86_64-unknown-linux-gnu"
url = "https://example.invalid/a.orax"
sha256 = "aa"
`,
  );
  assertEquals(
    releaseManifest(installed, {
      kind: "universal",
      url: "https://example.invalid/u.orax",
      sha256: "bb",
    }),
    `resolver = 1
identifier = "ora-space.opencode"

url = "https://example.invalid/u.orax"
sha256 = "bb"
`,
  );
});

Deno.test("a bound declaration renders after top-level keys and before the targets", () => {
  const association = {
    schemaVersion: 2,
    declarationSha256: DECLARATION_SHA256,
    copy: "agent-configuration.json",
  };
  assertEquals(
    releaseManifest("resolver = 1", {
      kind: "targets",
      targets: [{
        triple: "x86_64-unknown-linux-gnu",
        url: "https://example.invalid/a.orax",
        sha256: "aa",
      }],
    }, association),
    `resolver = 1

[agent_configuration]
schema_version = 2
declaration_sha256 = "${DECLARATION_SHA256}"
copy = "agent-configuration.json"

[[targets]]
target = "x86_64-unknown-linux-gnu"
url = "https://example.invalid/a.orax"
sha256 = "aa"
`,
  );
  // A universal url below the table would silently become one of its keys.
  assertEquals(
    releaseManifest("resolver = 1", {
      kind: "universal",
      url: "https://example.invalid/u.orax",
      sha256: "bb",
    }, association),
    `resolver = 1

url = "https://example.invalid/u.orax"
sha256 = "bb"

[agent_configuration]
schema_version = 2
declaration_sha256 = "${DECLARATION_SHA256}"
copy = "agent-configuration.json"
`,
  );
});
