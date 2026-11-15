import { afterEach, expect, test } from "bun:test";
import { INPUT_MASK } from "./controls.ts";
import { startGuestTransport, startHostTransport } from "./transport.ts";

const TOKEN = "transport-test-token";
const INPUT = INPUT_MASK & -INPUT_MASK;
const cleanup: (() => void)[] = [];

afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
});

function host(port = 0) {
  const states: number[] = [];
  const transport = startHostTransport({
    hostname: "127.0.0.1",
    port,
    token: TOKEN,
    onState: (state) => states.push(state),
    onStatus: () => {},
  });
  cleanup.push(transport.stop);
  return { ...transport, url: new URL(`http://127.0.0.1:${transport.port}`), states };
}

function socket(url: URL, token: string) {
  const endpoint = new URL("/input", url);
  endpoint.protocol = "ws:";
  const connection = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  cleanup.push(() => connection.terminate());
  return connection;
}

function packet(state: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(state);
  return bytes;
}

async function until(predicate: () => boolean, timeout = 2_500) {
  const deadline = performance.now() + timeout;
  while (!predicate() && performance.now() < deadline) await Bun.sleep(10);
  expect(predicate()).toBe(true);
}

test("validates bearer credentials and only admits one guest", async () => {
  const { url, states } = host();
  const endpoint = new URL("/input", url);
  expect((await fetch(endpoint)).status).toBe(401);
  expect((await fetch(endpoint, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(426);

  const wrongToken = socket(url, "wrong-token");
  await until(() => wrongToken.readyState === WebSocket.CLOSED);

  const first = socket(url, TOKEN);
  await until(() => first.readyState === WebSocket.OPEN);
  const second = socket(url, TOKEN);
  await until(() => second.readyState === WebSocket.CLOSED);

  first.send(packet(INPUT));
  await until(() => states[0] === INPUT);
  first.close();
  await until(() => states[1] === 0);

  const replacement = socket(url, TOKEN);
  await until(() => replacement.readyState === WebSocket.OPEN);
});

test("releases a held input on invalid reports and on timeout", async () => {
  const { url, states } = host();
  const invalidGuest = socket(url, TOKEN);
  await until(() => invalidGuest.readyState === WebSocket.OPEN);
  invalidGuest.send(packet(INPUT));
  await until(() => states[0] === INPUT);
  invalidGuest.send(packet(0xffff_ffff));
  await until(() => states[1] === 0 && invalidGuest.readyState === WebSocket.CLOSED);

  const stalledGuest = socket(url, TOKEN);
  await until(() => stalledGuest.readyState === WebSocket.OPEN);
  stalledGuest.send(packet(INPUT));
  await until(() => states[2] === INPUT);
  await until(() => states[3] === 0 && stalledGuest.readyState === WebSocket.CLOSED);
  expect(states).toEqual([INPUT, 0, INPUT, 0]);
});

test("guest sends changed inputs, maintains held inputs, and reconnects", async () => {
  const first = host();
  const guest = startGuestTransport({ url: first.url, token: TOKEN, onStatus: () => {} });
  cleanup.push(guest.stop);
  guest.setState(INPUT);
  await until(() => first.states[0] === INPUT);
  await Bun.sleep(3_200);
  expect(first.states).toEqual([INPUT]);

  guest.setState(0);
  await until(() => first.states[1] === 0);
  guest.setState(INPUT);
  await until(() => first.states[2] === INPUT);

  first.stop();
  expect(first.states).toEqual([INPUT, 0, INPUT, 0]);
  const replacement = host(first.port);
  await until(() => replacement.states[0] === INPUT);
  guest.stop();
  await until(() => replacement.states[1] === 0);
});

test("guest reconnects when the host socket stops responding", async () => {
  let connections = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response(null, { status: 426 });
    },
    websocket: {
      open(socket) {
        connections++;
        if (connections === 1) socket.pause();
      },
    },
  });
  cleanup.push(() => { void server.stop(true); });

  const guest = startGuestTransport({ url: server.url, token: TOKEN, onStatus: () => {} });
  cleanup.push(guest.stop);
  await until(() => connections === 2, 4_600);
}, 6_000);
