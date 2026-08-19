import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const VERSION = "0.1.0";

/** Port the local server listens on. */
export function port(): number {
  const raw = process.env.CRITIQUE_PORT;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 4477;
}

/** Interface the server binds to (loopback by default). */
export function host(): string {
  return process.env.CRITIQUE_HOST?.trim() || "127.0.0.1";
}

/** Hostname written into generated links (loopback for wildcard binds). */
export function linkHost(): string {
  const explicit = process.env.CRITIQUE_LINK_HOST?.trim();
  if (explicit) return explicit;
  const h = host();
  if (h === "0.0.0.0" || h === "::" || h === "") return "127.0.0.1";
  return h;
}

/** Directory holding persisted session state and the server log. */
export function stateDir(): string {
  const override = process.env.CRITIQUE_STATE_DIR?.trim();
  return override ? resolve(override) : join(homedir(), ".critique");
}

export function sessionsDir(): string {
  return join(stateDir(), "sessions");
}

export function serverLogPath(): string {
  return join(stateDir(), "server.log");
}

export function baseUrl(): string {
  return `http://${linkHost()}:${port()}`;
}
