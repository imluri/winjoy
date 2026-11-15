import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { createControllers } from "./controllers.ts";
import { openKeyboard } from "./keyboard.ts";
import { startGuestTransport, startHostTransport } from "./transport.ts";

export type SessionRequest =
  | { mode: "host"; bind: string; port: number }
  | { mode: "guest"; address: string; token: string };

export type SessionUpdate = {
  phase?: "running" | "error";
  status?: string;
  capture?: { enabled: boolean; active: boolean };
  connected?: boolean;
  latencyMs?: number | null;
  invite?: { address: string; token: string };
};

type SessionEvents = {
  update: (update: SessionUpdate) => void;
  error: (error: unknown) => void;
};

export function readSessionRequest(input: unknown): SessionRequest {
  if (!input || typeof input !== "object" || !("mode" in input)) throw new Error("Select Host or Join.");
  const values = input as Record<string, unknown>;
  if (values.mode === "host") {
    const { bind, port } = values;
    if (typeof bind !== "string" || !isIP(bind)) throw new Error("Choose a valid IP address to listen on.");
    if (typeof port !== "number" || !Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error("The port must be an integer from 0 to 65535.");
    }
    return { mode: "host", bind, port };
  }
  if (values.mode === "guest") {
    const address = typeof values.address === "string" ? values.address.trim() : "";
    const token = typeof values.token === "string" ? values.token.trim() : "";
    if (!URL.canParse(address)) throw new Error("Enter the host address from the invitation.");
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new Error("Copy the complete code from the current WinJoy invitation.");
    return { mode: "guest", address, token };
  }
  throw new Error("Select Host or Join.");
}

export function startSession(request: SessionRequest, { update, error }: SessionEvents): { close(): void } {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("WinJoy currently requires Windows x64 on both PCs.");
  }

  function poll(tick: () => void) {
    let timer: ReturnType<typeof setInterval>;
    const fail = (cause: unknown) => {
      clearInterval(timer);
      queueMicrotask(() => error(cause));
    };
    timer = setInterval(() => {
      try {
        tick();
      } catch (cause) {
        fail(cause);
      }
    }, 8);
    return { stop: () => clearInterval(timer), fail };
  }

  const onCapture = (_message: string, capture: NonNullable<SessionUpdate["capture"]>) => update({ capture });
  const onStatus = (status: string, connected: boolean) => update({ status, connected });
  const onLatency = (latencyMs: number | null) => update({ latencyMs });

  if (request.mode === "guest") {
    const keyboard = openKeyboard(onCapture);
    try {
      const transport = startGuestTransport({ url: new URL(request.address), token: request.token, onStatus, onLatency });
      const loop = poll(() => transport.setState(keyboard.sample()));
      update({ phase: "running" });
      return {
        close() {
          loop.stop();
          transport.stop();
          keyboard.close();
        },
      };
    } catch (cause) {
      keyboard.close();
      throw cause;
    }
  }

  const token = randomBytes(24).toString("base64url");
  const keyboard = openKeyboard(onCapture);
  try {
    const controllers = createControllers();
    let lastState = 0;
    const loop = poll(() => {
      const state = keyboard.sample();
      if (state === lastState) return;
      controllers.set(1, state);
      lastState = state;
    });
    try {
      const { bind, port } = request;
      const transport = startHostTransport({
        hostname: bind,
        port,
        token,
        onStatus,
        onLatency,
        onState(state) {
          try {
            controllers.set(2, state);
          } catch (cause) {
            loop.fail(cause);
          }
        },
      });
      const hostname = bind.includes(":") ? `[${bind}]` : bind;
      update({
        phase: "running",
        status: "Two controllers are ready. Waiting for Player 2.",
        invite: { address: `http://${hostname}:${transport.port}`, token },
        connected: false,
      });
      return {
        close() {
          loop.stop();
          try {
            transport.stop();
          } finally {
            controllers.close();
            keyboard.close();
          }
        },
      };
    } catch (cause) {
      loop.stop();
      controllers.close();
      throw cause;
    }
  } catch (cause) {
    keyboard.close();
    throw cause;
  }
}
