/** Decode a base64 string into raw bytes. Shared by sources that ship file
 * content as base64 JSON (Tauri IPC, the headless HTTP API). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}
