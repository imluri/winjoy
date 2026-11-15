import { parseArgs } from "node:util";
import { readSessionRequest, startSession } from "./session.ts";

const help = `WinJoy — two keyboards, two Xbox 360 controllers

  bun run desktop
  bun start host [--bind ADDRESS] [--port PORT] [--window TITLE]
  bun start guest HOST_URL --token TOKEN [--window TITLE]

The host defaults to 127.0.0.1:4747 and captures keys in the Cuphead window.
Use the host's private LAN or VPN IP with --bind to accept a remote guest.
--window limits capture to a case-insensitive substring of the window title.
The guest starts paused. Press F8 in the Steam stream to enable capture.
The guest can also set WINJOY_TOKEN in its environment.
Press Ctrl+C in the terminal to exit.`;

async function main() {
  const [mode, ...args] = Bun.argv.slice(2);
  if (!mode || mode === "--help" || mode === "-h" || mode === "help" || args.includes("--help")) {
    console.log(help);
    return;
  }

  if (mode !== "host" && mode !== "guest") throw new Error(`Unknown command "${mode}". Run bun start --help.`);
  const request = mode === "host"
    ? (() => {
      const { values } = parseArgs({
        args,
        options: { bind: { type: "string" }, port: { type: "string" }, window: { type: "string" } },
      });
      const port = values.port ?? "4747";
      if (!/^\d+$/.test(port)) throw new Error("Pass a numeric port to --port.");
      return readSessionRequest({ mode, bind: values.bind ?? "127.0.0.1", port: Number(port), windowTitle: values.window });
    })()
    : (() => {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: { token: { type: "string" }, window: { type: "string" } },
      });
      if (positionals.length !== 1) throw new Error("Pass the host URL printed by WinJoy.");
      return readSessionRequest({ mode, address: positionals[0], token: values.token ?? Bun.env.WINJOY_TOKEN, windowTitle: values.window });
    })();

  const stop = Promise.withResolvers<void>();
  const session = startSession(request, {
    error: stop.reject,
    update({ status, invite, capture }) {
      if (status) console.log(status);
      if (invite) console.log(`Guest command: bun start guest ${invite.address} --token ${invite.token}`);
      if (capture) {
        console.log(capture.active ? "Keyboard capture active." : capture.enabled
          ? "Waiting for the capture window to come into focus."
          : "Keyboard capture paused. Press F8 to enable.");
      }
    },
  });
  const quit = () => stop.resolve();
  process.once("SIGINT", quit);
  process.once("SIGTERM", quit);
  try {
    await stop.promise;
  } finally {
    process.off("SIGINT", quit);
    process.off("SIGTERM", quit);
    session.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`WinJoy: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
