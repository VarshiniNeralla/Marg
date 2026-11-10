/** SHA-256 fingerprint of a photo, computed on the phone at capture time and compared with the server's afterwards. */

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/**
 * Hex SHA-256 of the file, or undefined when this environment cannot compute one (no secure-context crypto).
 * Reads the file once (one ~12 MB buffer, released straight after), so call it for one photo at a time.
 */
export async function sha256OfBlob(blob: Blob): Promise<string | undefined> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return undefined;
    const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
    return bytesToHex(new Uint8Array(digest));
  } catch {
    return undefined;
  }
}
