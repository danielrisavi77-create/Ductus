// DAN-324: preloaded (`node --import`) into the fake OIDC provider of the
// native runner. infra/fake-oidc/server.mjs listens on its port alone, which
// in Compose is the container; without a container it would be every
// interface. This binds each listen to 127.0.0.1, so the provider stays
// local (D-09) without a change to the provider itself.
import { Server } from "node:net";

const listen = Server.prototype.listen;
Server.prototype.listen = function listenOnLoopback(...args) {
  if (typeof args[0] === "number" || (typeof args[0] === "string" && /^\d+$/.test(args[0]))) {
    const callback = typeof args.at(-1) === "function" ? [args.at(-1)] : [];
    return listen.call(this, Number(args[0]), "127.0.0.1", ...callback);
  }
  if (args[0] && typeof args[0] === "object" && "port" in args[0] && !("path" in args[0])) {
    return listen.call(this, { ...args[0], host: "127.0.0.1" }, ...args.slice(1));
  }
  throw new Error("the native fake OIDC provider listens on a loopback port only");
};
