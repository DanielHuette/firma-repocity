import { timingSafeEqual } from "node:crypto";
import type * as Crypto from "node:crypto";
import { createServer, request } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPORT_PATH, ReportInlet, SECRET_HEADER } from "../src/meldungen.ts";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof Crypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET = "0a".repeat(32);

let server: Server;
let port: number;

beforeEach(async () => {
  const inlet = new ReportInlet({
    secret: SECRET,
    sessions: { list: () => [], setClaudeSession: () => Promise.resolve() },
    onReport: () => undefined,
    onError: () => undefined,
  });
  server = createServer((incoming, outgoing) => {
    inlet.handle(incoming, outgoing);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  vi.mocked(timingSafeEqual).mockClear();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => {
    resolve();
  }));
});

function statusWith(secret: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port,
        path: REPORT_PATH,
        method: "POST",
        headers: { "content-type": "application/json", [SECRET_HEADER]: secret },
      },
      (incoming) => {
        incoming.resume();
        resolve(incoming.statusCode ?? 0);
      },
    );
    outgoing.on("error", reject);
    outgoing.end(JSON.stringify({ sitzung: null, art: "hook", daten: { session_id: "x", hook_event_name: "Stop" } }));
  });
}

describe("constant-time comparison of the secret", () => {
  it.each([
    ["the right secret", SECRET, 204],
    ["a wrong secret of the same length", "0b".repeat(32), 401],
    ["a short secret", "0a", 401],
  ])("compares %s with timingSafeEqual on equally long digests", async (_case, secret, status) => {
    expect(await statusWith(secret)).toBe(status);
    expect(vi.mocked(timingSafeEqual)).toHaveBeenCalledTimes(1);
    const [candidate, known] = vi.mocked(timingSafeEqual).mock.calls[0] ?? [];
    expect(Buffer.isBuffer(candidate) && candidate.length).toBe(32);
    expect(Buffer.isBuffer(known) && known.length).toBe(32);
  });
});
