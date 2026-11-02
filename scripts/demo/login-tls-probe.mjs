// TEMPORARY diagnostic for DAN-232 (WebKit TLS handshake in CI); removed before merge.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 10_000 }).trim();
  } catch (error) {
    return `ERR ${error.message}`;
  }
};

const handshake = (host) =>
  new Promise((resolve) => {
    const socket = tls.connect({ host, port: 3000, servername: "localhost", rejectUnauthorized: false, timeout: 8000 }, () => {
      resolve(`${host}: tls ok ${socket.getProtocol()} ${socket.getCipher().name} alpn=${socket.alpnProtocol}`);
      socket.end();
    });
    socket.on("error", (error) => resolve(`${host}: tls ERR ${error.message}`));
    socket.on("timeout", () => resolve(`${host}: tls timeout`));
  });

const plain = (host) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port: 3000, timeout: 5000 }, () => socket.write("GET / HTTP/1.0\r\n\r\n"));
    let data = "";
    socket.on("data", (chunk) => (data += chunk.toString("latin1")));
    socket.on("close", () => resolve(`${host}: plain reply ${JSON.stringify(data.slice(0, 120))}`));
    socket.on("error", (error) => resolve(`${host}: plain ERR ${error.message}`));
    socket.on("timeout", () => {
      socket.destroy();
    });
  });

export default async function globalSetup() {
  const lines = [];
  lines.push(`hosts: ${sh("getent", ["ahosts", "localhost"]).replace(/\n/g, " | ")}`);
  lines.push(`etc/hosts: ${readFileSync("/etc/hosts", "utf8").replace(/\n/g, " | ")}`);
  lines.push(`listen: ${sh("ss", ["-ltnp"]).replace(/\n/g, " | ")}`);
  lines.push(`env proxy: ${["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY", "no_proxy", "NO_PROXY", "all_proxy"].map((k) => `${k}=${process.env[k] ?? ""}`).join(" ")}`);
  lines.push(`openssl: ${sh("openssl", ["version"])}; node ${process.version} openssl ${process.versions.openssl}`);
  for (const host of ["127.0.0.1", "::1"]) {
    lines.push(await handshake(host));
    lines.push(await plain(host));
  }
  console.log(`[tls-probe]\n${lines.map((line) => `[tls-probe] ${line}`).join("\n")}`);
}
