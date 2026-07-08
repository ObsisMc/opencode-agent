/**
 * Wraps a Bun `FileSink` (the shape of `Bun.stdout.writer()` and a spawned
 * child process's `stdin` when piped) as a standard `WritableStream<Uint8Array>`,
 * since ACP's `ndJsonStream` expects Web Streams.
 */
export function fileSinkToWritable(sink: {
  write(chunk: Uint8Array): number | Promise<number>;
  flush(): number | Promise<number>;
  end(): number | Promise<number>;
}): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      await sink.write(chunk);
      await sink.flush();
    },
    async close() {
      await sink.end();
    },
    async abort() {
      await sink.end();
    },
  });
}
