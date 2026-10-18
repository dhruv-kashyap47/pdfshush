/**
 * The Fill & Sign audit sidecar (P6.1, PLAN.md §25.1 D2).
 *
 * A small JSON record generated **entirely on the device**, offered as a
 * second download beside the signed PDF. It is evidence the signer owns, not
 * a certification: D1 forbids any eIDAS/ESIGN claim in copy or schema.
 *
 * Fail-closed: SHA-256 comes from SubtleCrypto, which needs a secure context.
 * When digests are impossible, no sidecar is produced at all (with a visible
 * reason) -- never a digest-less note that implies more protection than it has.
 */

export const AUDIT_SCHEMA = 'pdfshush.audit-trail/1' as const;

export interface AuditPlacement {
  pageIndex: number;
  /** Display-space rect, same values the editor handed the export (pt). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AuditSidecarInput {
  sourceName: string;
  sourceBytes: Uint8Array | ArrayBuffer;
  outputName: string;
  outputBytes: Uint8Array | ArrayBuffer;
  /** Signature render kind for this export (raster in slice one). */
  renderKind: 'raster' | 'vector';
  method: 'drawn' | 'typed';
  label: string | undefined;
  placements: AuditPlacement[];
}

/** `hex`-string digest; `null` when SubtleCrypto is unusable (D2 fail-closed). */
export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || crypto.subtle === undefined) return null;
    if (typeof isSecureContext === 'boolean' && !isSecureContext) return null;
    // Copy into a plain ArrayBuffer: callers may hand a view into a larger
    // SharedArrayBuffer-backed heap, which SubtleCrypto accepts as BufferSource
    // in browsers but not in this stricter DOM type.
    const view: ArrayBuffer =
      bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer as ArrayBuffer;
    const digest = await crypto.subtle.digest('SHA-256', view);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export interface AuditSidecar {
  schema: typeof AUDIT_SCHEMA;
  source: { digest: string; filename: string };
  output: { digest: string; filename: string };
  signed: {
    method: 'drawn' | 'typed';
    signerLabel?: string;
    renderKind: 'raster' | 'vector';
    placements: AuditPlacement[];
  };
  time: { iso: string; timeSource: 'client' };
  attestation: { certified: false; note: string };
}

/**
 * Builds the sidecar or reports exactly why it could not. The caller shows the
 * reason; the schema never ships a degraded, digest-less form (D2).
 */
export async function buildAuditSidecar(
  input: AuditSidecarInput,
): Promise<{ sidecar: AuditSidecar; fileName: string } | { error: string }> {
  const [sourceDigest, outputDigest] = await Promise.all([
    sha256Hex(input.sourceBytes),
    sha256Hex(input.outputBytes),
  ]);
  if (!sourceDigest || !outputDigest) {
    return {
      error: 'no-secure-context: SHA-256 unavailable, no audit note is written (fail-closed)',
    };
  }
  const iso = new Date().toISOString();
  const stem = input.outputName.replace(/\.pdf$/i, '');
  const sidecar: AuditSidecar = {
    schema: AUDIT_SCHEMA,
    source: { digest: sourceDigest, filename: input.sourceName },
    output: { digest: outputDigest, filename: input.outputName },
    signed: {
      method: input.method,
      ...(input.label ? { signerLabel: input.label } : {}),
      renderKind: input.renderKind,
      placements: input.placements,
    },
    time: { iso, timeSource: 'client' },
    // D1: an ordinary signature with an honest description of what this file
    // does and does not attest to. The recipient can recompute `output.digest`
    // to detect later tampering; nothing here certifies identity.
    attestation: {
      certified: false,
      note:
        'This audit note was produced locally by the signer. Identity is self-declared; ' +
        'the digest lets anyone verify the signed file matches the one this record describes.',
    },
  };
  return { sidecar, fileName: `${stem}-audit.json` };
}

/** `<stem>-audit.json` for the given output filename. */
export function sidecarFileNameFor(outputName: string): string {
  return `${outputName.replace(/\.pdf$/i, '')}-audit.json`;
}
