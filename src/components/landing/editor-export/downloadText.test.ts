import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadText } from "./downloadText";

const samples = [
  { name: "empty text", text: "" },
  { name: "Croatian and other Unicode", text: "ČĆŽŠĐ čćžšđ e\u0301 🌿 𐍈" },
  { name: "an initial BOM character and embedded NUL", text: "\ufeffpočetak\0kraj" },
  { name: "paragraphs and existing line endings", text: "Prvi redak\r\nDrugi redak\n\nTreći odlomak\rKraj\n" },
  { name: "long synthetic text", text: `${"Izmišljeni odlomak čž.\n\n".repeat(20_000)}Završetak` },
];

describe("downloadText", () => {
  const link = { href: "", download: "", click: vi.fn() };
  const forbidden = vi.fn(() => { throw new Error("unexpected network or storage access"); });

  beforeEach(() => {
    vi.useFakeTimers();
    link.href = "";
    link.download = "";
    link.click.mockReset();
    forbidden.mockClear();
    vi.stubGlobal("document", { createElement: vi.fn(() => link) });
    vi.stubGlobal("fetch", forbidden);
    vi.stubGlobal("localStorage", { getItem: forbidden, setItem: forbidden, removeItem: forbidden });
    vi.stubGlobal("sessionStorage", { getItem: forbidden, setItem: forbidden, removeItem: forbidden });
    vi.stubGlobal("indexedDB", { open: forbidden, deleteDatabase: forbidden });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does nothing on import; the caller initiates the action", async () => {
    vi.resetModules();
    await import("./downloadText");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(link.click).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it.each(samples)("puts the exact UTF-8 bytes of $name in the Blob", async ({ text }) => {
    downloadText(text);

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/plain;charset=utf-8");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes).toEqual(new TextEncoder().encode(text));
    expect(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)).toBe(text);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("requests a download with a fixed name and releases its URL after the browser can start it", () => {
    downloadText("Izmišljeni tekst");

    expect(document.createElement).toHaveBeenCalledExactlyOnceWith("a");
    expect(link.href).toBe("blob:synthetic");
    expect(link.download).toBe("ductura-tekst.txt");
    expect(link.click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(9_999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:synthetic");
  });

  it("releases each URL after repeated requests", () => {
    vi.mocked(URL.createObjectURL).mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    downloadText("prvi");
    downloadText("drugi");
    vi.runAllTimers();
    expect(vi.mocked(URL.revokeObjectURL).mock.calls).toEqual([["blob:first"], ["blob:second"]]);
  });

  it("propagates a URL creation error without attempting a download", () => {
    const failure = new Error("URL unavailable");
    vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw failure; });
    expect(() => downloadText("tekst")).toThrow(failure);
    expect(link.click).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("propagates a click error and releases the already created URL", () => {
    const failure = new Error("click failed");
    link.click.mockImplementationOnce(() => { throw failure; });
    expect(() => downloadText("tekst")).toThrow(failure);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:synthetic");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates a timer setup error and releases the URL", () => {
    const failure = new Error("timer unavailable");
    vi.spyOn(globalThis, "setTimeout").mockImplementationOnce(() => { throw failure; });
    expect(() => downloadText("tekst")).toThrow(failure);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:synthetic");
  });

  it.each(["\ud800", "\udc00", "\ud800x", "x\udc00", "\ud800\ud800", "\udc00\udc00"])(
    "rejects an unpaired surrogate rather than silently changing the text",
    (text) => {
      expect(() => downloadText(text)).toThrow(TypeError);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(link.click).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-string at runtime", () => {
    expect(() => downloadText(123 as unknown as string)).toThrow(TypeError);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
