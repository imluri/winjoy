import { timingSafeEqual } from "node:crypto";
import type { ServerWebSocket } from "bun";
import { INPUT_MASK } from "./controls.ts";

const INPUT_PATH = "/input";
const INPUT_BYTES = 4;
const HEARTBEAT_MS = 200;
const GUEST_TIMEOUT_MS = 1_000;
const PING_INTERVAL_MS = 1_000;
const PONG_TIMEOUT_MS = 3_000;
const CONNECT_TIMEOUT_MS = 5_000;
const INITIAL_RETRY_MS = 500;
const MAX_RETRY_MS = 5_000;

type StatusHandler = (message: string, connected: boolean) => void;

interface HostOptions {
  hostname: string;
  port: number;
  token: string;
  onState: (state: number) => void;
  onStatus: StatusHandler;
}

interface GuestOptions {
  url: URL;
  token: string;
  onStatus: StatusHandler;
}

interface GuestSeat {
  socket?: ServerWebSocket<GuestSeat>;
  lastSeen: number;
}

export function startHostTransport({ hostname, port, token, onState, onStatus }: HostOptions) {
  const expectedAuth = Buffer.from(`Bearer ${token}`);
  let guest: GuestSeat | undefined;
  let state = 0;

  function apply(next: number) {
    if (next !== state) {
      onState(next);
      state = next;
    }
  }

  function release(seat: GuestSeat) {
    if (guest !== seat) return false;
    guest = undefined;
    apply(0);
    return true;
  }

  const server = Bun.serve({
    hostname,
    port,
    fetch(request, server) {
      const { pathname, search } = new URL(request.url);
      if (pathname === "/" && request.method === "GET") return new Response("WinJoy ready\n");
      if (pathname !== INPUT_PATH || search) return new Response(null, { status: 404 });
      if (request.method !== "GET") return new Response(null, { status: 405 });

      const auth = Buffer.from(request.headers.get("Authorization") ?? "");
      if (auth.length !== expectedAuth.length || !timingSafeEqual(auth, expectedAuth)) {
        return new Response(null, { status: 401 });
      }
      if (guest) return new Response("Player 2 is already connected\n", { status: 409 });

      const seat = { lastSeen: performance.now() };
      guest = seat;
      if (server.upgrade(request, { data: seat })) return;
      release(seat);
      return new Response(null, { status: 426 });
    },
    websocket: {
      data: {} as GuestSeat,
      maxPayloadLength: INPUT_BYTES,
      perMessageDeflate: false,
      open(socket) {
        if (guest !== socket.data) {
          socket.close();
          return;
        }
        socket.data.socket = socket;
        onStatus("Player 2 connected.", true);
      },
      message(socket, message) {
        if (guest !== socket.data) return;
        const next = typeof message === "string" || message.length !== INPUT_BYTES
          ? undefined
          : message.readUInt32LE();
        if (next === undefined || (next & INPUT_MASK) !== next) {
          socket.close(1008, "Invalid controller state");
          if (release(socket.data)) onStatus("Player 2 sent an invalid controller state.", false);
          return;
        }
        socket.data.lastSeen = performance.now();
        apply(next);
      },
      close(socket) {
        if (release(socket.data)) onStatus("Player 2 disconnected.", false);
      },
    },
  });

  const timeout = setInterval(() => {
    const seat = guest;
    if (!seat || performance.now() - seat.lastSeen < GUEST_TIMEOUT_MS) return;
    if (release(seat)) onStatus("Player 2 timed out.", false);
    seat.socket?.close(1008, "Controller input timed out");
  }, 100);

  return {
    port: server.port!,
    stop() {
      clearInterval(timeout);
      if (guest) release(guest);
      void server.stop(true);
    },
  };
}

export function startGuestTransport({ url, token, onStatus }: GuestOptions) {
  const endpoint = new URL(url);
  if (endpoint.protocol === "http:") endpoint.protocol = "ws:";
  if (endpoint.protocol === "https:") endpoint.protocol = "wss:";
  if (endpoint.pathname === "/") endpoint.pathname = INPUT_PATH;
  if ((endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") ||
      endpoint.pathname !== INPUT_PATH || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash) {
    throw new Error("Use the host URL without a username, password, query, or fragment.");
  }

  let socket: WebSocket | undefined;
  let state = 0;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let connectTimeout: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = INITIAL_RETRY_MS;
  let lastPong = 0;
  let nextPing = 0;

  function send() {
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount >= 1024) {
      socket.terminate();
      return;
    }
    const packet = Buffer.alloc(INPUT_BYTES);
    packet.writeUInt32LE(state);
    socket.send(packet);
  }

  function connect() {
    const connection = new WebSocket(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      perMessageDeflate: false,
    });
    socket = connection;
    connectTimeout = setTimeout(() => connection.terminate(), CONNECT_TIMEOUT_MS);

    connection.addEventListener("open", () => {
      if (socket !== connection) return;
      clearTimeout(connectTimeout);
      retryDelay = INITIAL_RETRY_MS;
      lastPong = performance.now();
      nextPing = lastPong + PING_INTERVAL_MS;
      onStatus("Connected to the host as Player 2.", true);
      send();
    });
    connection.addEventListener("pong", () => {
      if (socket === connection) lastPong = performance.now();
    });
    connection.addEventListener("close", () => {
      if (socket !== connection || stopped) return;
      socket = undefined;
      clearTimeout(connectTimeout);
      onStatus(`Host connection closed. Retrying in ${retryDelay / 1000}s.`, false);
      retry = setTimeout(connect, retryDelay);
      retryDelay = Math.min(MAX_RETRY_MS, retryDelay * 2);
    });
  }

  onStatus(`Connecting to ${endpoint.host} as Player 2.`, false);
  connect();
  const heartbeat = setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (now - lastPong >= PONG_TIMEOUT_MS) {
      socket.terminate();
      return;
    }
    if (now >= nextPing) {
      socket.ping();
      nextPing = now + PING_INTERVAL_MS;
    }
    send();
  }, HEARTBEAT_MS);

  return {
    setState(next: number) {
      if (stopped || state === next) return;
      state = next;
      send();
    },
    stop() {
      stopped = true;
      clearInterval(heartbeat);
      clearTimeout(retry);
      clearTimeout(connectTimeout);
      if (socket?.readyState === WebSocket.OPEN) socket.close();
      else socket?.terminate();
      socket = undefined;
    },
  };
}
