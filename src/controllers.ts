import { dlopen, ptr } from "bun:ffi";
import { resolve } from "node:path";
import { toReport } from "./controls.ts";

const VIGEM_SUCCESS = 0x20000000;
const DRIVER_RELEASE = "https://github.com/nefarius/ViGEmBus/releases/tag/v1.22.0";
const REPORT_BYTES = 12;
const REPORT_ALIGNMENT = 16;
const DEVICE_SETUP_ATTEMPTS = 8;

class ControllerNotReady extends Error {}

function checkResult(code: number, operation: string) {
  if (code === VIGEM_SUCCESS) return;

  const status = `0x${code.toString(16).toUpperCase().padStart(8, "0")}`;
  switch (code) {
    case 0xe0000001:
    case 0xe0000008:
      throw new Error(`${operation} failed (${status}). Install ViGEmBus 1.22.0 and restart WinJoy: ${DRIVER_RELEASE}`);
    case 0xe0000002:
      throw new Error(`${operation} failed (${status}). Close other virtual-controller apps to free controller slots.`);
    case 0xe0000007:
      throw new ControllerNotReady(`${operation} failed (${status}). Windows could not start the virtual Xbox device. Restart Windows if ViGEmBus was just installed, then retry.`);
    case 0xe0000009:
      throw new Error(`${operation} failed (${status}). Windows blocked access to the ViGEmBus device. Run WinJoy from a local Windows terminal.`);
    default:
      throw new Error(`${operation} failed with ViGEm status ${status}.`);
  }
}

function loadClient() {
  const override = process.env.WINJOY_VIGEM_DLL;
  const path = override
    ? resolve(override)
    : resolve(import.meta.dir, "../node_modules/vigemclient/native/x64/ViGEmClient.dll");

  try {
    return dlopen(path, {
      vigem_alloc: { args: [], returns: "ptr" },
      vigem_free: { args: ["ptr"], returns: "void" },
      vigem_connect: { args: ["ptr"], returns: "u32" },
      vigem_disconnect: { args: ["ptr"], returns: "void" },
      vigem_target_x360_alloc: { args: [], returns: "ptr" },
      vigem_target_free: { args: ["ptr"], returns: "void" },
      vigem_target_add: { args: ["ptr", "ptr"], returns: "u32" },
      vigem_target_remove: { args: ["ptr", "ptr"], returns: "u32" },
      vigem_target_x360_update: { args: ["ptr", "ptr", "ptr"], returns: "u32" },
    });
  } catch (cause) {
    const remedy = override
      ? "Point WINJOY_VIGEM_DLL to a compatible x64 ViGEmClient.dll."
      : "Run bun install --ignore-scripts from the WinJoy folder.";
    throw new Error(`Couldn't load the x64 ViGEm client at ${path}. ${remedy} ${String(cause)}`, { cause });
  }
}

function openControllers(): { set(player: 1 | 2, state: number): void; close(): void } {
  // ViGEm's XUSB_REPORT is 12 bytes and passed by value. The Windows x64 ABI
  // passes this aggregate as a pointer to caller-owned, 16-byte-aligned memory.
  // https://learn.microsoft.com/en-us/cpp/build/x64-calling-convention#parameter-passing
  const storage = new Uint8Array(REPORT_ALIGNMENT * 2 - 1);
  const offset = (REPORT_ALIGNMENT - (ptr(storage) % REPORT_ALIGNMENT)) % REPORT_ALIGNMENT;
  const scratch = storage.subarray(offset, offset + REPORT_ALIGNMENT);
  const bytes = new DataView(scratch.buffer, scratch.byteOffset, REPORT_BYTES);

  const library = loadClient();
  const api = library.symbols;
  type ClientPointer = NonNullable<ReturnType<typeof api.vigem_alloc>>;
  type TargetPointer = NonNullable<ReturnType<typeof api.vigem_target_x360_alloc>>;
  const targets: TargetPointer[] = [];
  let client: ClientPointer | null = null;
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;

    if (client) {
      for (const target of targets) api.vigem_target_remove(client, target);
      api.vigem_disconnect(client);
      for (const target of targets) api.vigem_target_free(target);
      api.vigem_free(client);
    }
    library.close();
  }

  function set(player: 1 | 2, state: number) {
    const target = targets[player - 1];
    if (closed || !client || !target) throw new Error(`Controller ${player} is unavailable.`);

    const { buttons, lt, rt, lx, ly, rx, ry } = toReport(state);
    bytes.setUint16(0, buttons, true);
    bytes.setUint8(2, lt);
    bytes.setUint8(3, rt);
    bytes.setInt16(4, lx, true);
    bytes.setInt16(6, ly, true);
    bytes.setInt16(8, rx, true);
    bytes.setInt16(10, ry, true);
    checkResult(api.vigem_target_x360_update(client, target, scratch), `Updating controller ${player}`);
  }

  try {
    client = api.vigem_alloc();
    if (!client) throw new Error("Couldn't allocate a ViGEm client.");
    checkResult(api.vigem_connect(client), "Connecting to ViGEmBus");

    for (const player of [1, 2] as const) {
      const target = api.vigem_target_x360_alloc();
      if (!target) throw new Error(`Couldn't allocate controller ${player}.`);
      targets.push(target);
      checkResult(api.vigem_target_add(client, target), `Connecting controller ${player}`);
      set(player, 0);
    }

    return { set, close };
  } catch (error) {
    close();
    throw error;
  }
}

export function createControllers() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Hosting virtual Xbox controllers requires Windows with x64 Bun.");
  }

  for (let attempt = 1; ; attempt++) {
    try {
      return openControllers();
    } catch (error) {
      if (!(error instanceof ControllerNotReady) || attempt >= DEVICE_SETUP_ATTEMPTS) throw error;
      // On first use, Windows may still be installing the Xbox 360 device driver.
      Bun.sleepSync(1000);
    }
  }
}
