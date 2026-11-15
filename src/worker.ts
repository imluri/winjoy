import { createInterface } from "node:readline";
import { readSessionRequest, startSession, type SessionUpdate } from "./session.ts";

const input = createInterface({ input: process.stdin });
let session: ReturnType<typeof startSession> | undefined;
let closed = false;

function update(value: SessionUpdate) {
  if (!closed) process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(error: unknown) {
  if (closed) return;
  update({ phase: "error", status: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
  input.close();
}

input.once("line", (line) => {
  try {
    const request = readSessionRequest(JSON.parse(line));
    session = startSession(request, { update, error: fail });
  } catch (error) {
    fail(error);
  }
});

input.once("close", () => {
  closed = true;
  process.stdin.pause();
  session?.close();
});

process.stdout.on("error", () => input.close());
