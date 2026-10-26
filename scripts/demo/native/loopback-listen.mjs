// DAN-324 (#799): preloaded with `node --import` into the fake OIDC server of
// the native demo. infra/fake-oidc calls listen(port), which binds every
// interface (in Compose only the container's port is published, on
// 127.0.0.1). Here every TCP listen of the process binds 127.0.0.1 instead,
// and infra/fake-oidc stays unchanged. A pipe or socket path is left alone.
import { Server } from "node:net";

const LOOPBACK = "127.0.0.1";
const listen = Server.prototype.listen;

export function loopbackArgs(args) {
  const [first, second] = args;
  if (first === undefined || typeof first === "function") return [0, LOOPBACK, ...args.slice(first === undefined ? 1 : 0)];
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
    return typeof second === "string" ? [first, LOOPBACK, ...args.slice(2)] : [first, LOOPBACK, ...args.slice(1)];
  }
  if (first !== null && typeof first === "object" && first.path === undefined && first.handle === undefined && first.fd === undefined) {
    return [{ ...first, host: LOOPBACK }, ...args.slice(1)];
  }
  return args;
}

Server.prototype.listen = function loopbackListen(...args) {
  return listen.apply(this, loopbackArgs(args));
};
