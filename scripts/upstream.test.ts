import { verifyIntegrity } from "./upstream.ts";

Deno.test("npm archives must match the pinned SHA-512 before extraction", async () => {
  const bytes = new TextEncoder().encode("release archive");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
  const integrity = `sha512-${btoa(String.fromCharCode(...digest))}`;
  await verifyIntegrity(bytes, integrity);
  for (
    const [content, sri] of [
      [new TextEncoder().encode("replaced archive"), integrity],
      [bytes, "sha256-not-a-sha512-pin"],
    ] as const
  ) {
    let rejected = false;
    try {
      await verifyIntegrity(content, sri);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("unverified archive was accepted");
  }
});
