const FILE_NAME = "ductura-tekst.txt";
const RELEASE_URL_AFTER_MS = 10_000;

/**
 * Request a UTF-8 TXT download during a user gesture, using only the supplied
 * text. A browser can block or cancel the download; this does not report that
 * it completed. Malformed UTF-16 is rejected rather than silently replaced
 * while encoding the text as UTF-8.
 */
export function downloadText(text: string): void {
  if (typeof text !== "string") throw new TypeError("Text must be a string");
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("Text contains an unpaired surrogate");
      }
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("Text contains an unpaired surrogate");
    }
  }

  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = FILE_NAME;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), RELEASE_URL_AFTER_MS);
  } catch (error) {
    // Preserve the error that prevented the request even if cleanup fails.
    try { URL.revokeObjectURL(url); } catch { /* nothing else can release it */ }
    throw error;
  }
}
