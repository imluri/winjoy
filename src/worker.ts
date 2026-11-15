import { createInterface } from "node:readline";
import { readSessionRequest, startSession, type SessionUpdate } from "./session.ts";
import { checkForUpdate, readUpdateRequest, type UpdateResult } from "./updater.ts";

const input = createInterface({ input: process.stdin });
let session: ReturnType<typeof startSession> | undefined;
let closed = false;
const updateAbort = new AbortController();

function update(value: SessionUpdate | UpdateResult) {
  if (!closed) process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(error: unknown) {
  if (closed) return;
  update({ phase: "error", status: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
  input.close();
}

input.once("line", async (line) => {
  try {
    const request = JSON.parse(line);
    if (request?.mode === "update") {
      await checkForUpdate(readUpdateRequest(request), update, updateAbort.signal);
      input.close();
      return;
    }
    session = startSession(readSessionRequest(request), { update, error: fail });
  } catch (error) {
    fail(error);
  }
});

input.once("close", () => {
  closed = true;
  updateAbort.abort();
  process.stdin.pause();
  session?.close();
});

process.stdout.on("error", () => input.close());
