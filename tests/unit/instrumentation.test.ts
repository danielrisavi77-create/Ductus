import { EventEmitter } from "node:events";
import { ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { register } from "../../instrumentation";

// DAN-299: the Node server process ends at start when APP_DATABASE_URL is unusable,
// naming the variable only; the edge runtime checks nothing.
const exitSpy = () => vi.fn((code: number): never => {
  throw new Error(`exit ${code}`);
});

describe("instrumentation register()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("ends the Node process with 1 and names only the variable when it is missing", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_DATABASE_URL", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = exitSpy();
    await expect(register(exit)).rejects.toThrow("exit 1");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith("Ductus cannot start: APP_DATABASE_URL is not set");
  });

  it("never prints the value of a wrong variable", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_DATABASE_URL", "mysql://user:invented-secret@db.example.test/ductus");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(register(exitSpy())).rejects.toThrow("exit 1");
    const printed = error.mock.calls.flat().join(" ");
    expect(printed).toContain("APP_DATABASE_URL is not a postgres URL");
    expect(printed).not.toContain("invented-secret");
    expect(printed).not.toContain("db.example.test");
  });

  it("starts with a postgres URL", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_DATABASE_URL", "postgres://user:invented-secret@127.0.0.1:5432/ductus");
    const exit = exitSpy();
    await register(exit, new EventEmitter());
    expect(exit).not.toHaveBeenCalled();
  });

  it("puts the security header floor on Node responses once it starts (DAN-498)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_DATABASE_URL", "postgres://user:invented-secret@127.0.0.1:5432/ductus");
    const signals = new EventEmitter();
    await register(exitSpy(), signals);
    const installed = ServerResponse.prototype.writeHead;
    expect(installed.name).toBe("writeHeadWithFloor");
    await register(exitSpy(), signals);
    expect(ServerResponse.prototype.writeHead).toBe(installed);
  });

  it("listens to SIGTERM and SIGINT once however often it starts (DAN-587)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_DATABASE_URL", "postgres://user:invented-secret@127.0.0.1:5432/ductus");
    const signals = new EventEmitter();
    await register(exitSpy(), signals);
    await register(exitSpy(), signals);
    expect(signals.listenerCount("SIGTERM")).toBe(1);
    expect(signals.listenerCount("SIGINT")).toBe(1);
  });

  it("listens to no signal when the environment is refused (DAN-587)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_DATABASE_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const signals = new EventEmitter();
    await expect(register(exitSpy(), signals)).rejects.toThrow("exit 1");
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("checks nothing outside the Node runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("APP_DATABASE_URL", "");
    const exit = exitSpy();
    const signals = new EventEmitter();
    await register(exit, signals);
    expect(exit).not.toHaveBeenCalled();
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });
});
