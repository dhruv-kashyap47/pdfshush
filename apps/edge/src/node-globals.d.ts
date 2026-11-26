/**
 * Type-only shims for Node globals that leak in through `@pdfshush/ai-provider`.
 *
 * That package is consumed from TypeScript source, so `tsc` typechecks all of
 * it — including two files this Worker never loads:
 *
 *   - `credential-env.ts` defaults an argument to `process.env`, and is only
 *     reachable from `resolveProfileCredential`, which nothing here imports;
 *   - `media-protocols.ts` guards every `Buffer` use with
 *     `typeof Buffer !== 'undefined'`.
 *
 * `sideEffects: false` means the bundler drops both, so neither global is
 * evaluated at runtime. Declaring them here keeps the Worker's own tsconfig free
 * of `@types/node` — which would otherwise tell the compiler that `fs` and
 * `process` are available in a realm that has neither.
 */

declare const process: { env: Record<string, string | undefined> };

interface NodeBufferLike extends Uint8Array {
  toString(encoding?: string): string;
}

declare const Buffer: {
  from(input: ArrayBuffer | Uint8Array | string, encoding?: string): NodeBufferLike;
};

declare namespace NodeJS {
  type Timeout = unknown;
  /**
   * Only ever the left half of `NodeJS.ReadableStream | ReadableStream<Uint8Array>`,
   * which the callee immediately casts to the DOM type. Never constructed here.
   */
  interface ReadableStream {}
}
