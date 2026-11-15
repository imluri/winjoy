import { dlopen, ptr } from "bun:ffi";
import { KEYBOARD_BINDINGS } from "./controls.ts";

const VK_F8 = 0x77;
const TITLE_CAPACITY = 1_024;

export function openKeyboard(
  windowTitle?: string,
  startPaused = windowTitle === undefined,
  onStatus: (message: string, capture: { enabled: boolean; active: boolean }) => void = (message) => console.log(message),
) {
  if (process.platform !== "win32") {
    throw new Error("WinJoy keyboard capture requires Windows.");
  }

  const titlePattern = windowTitle?.trim().toLowerCase();
  if (titlePattern === "") {
    throw new Error("The capture window title must contain at least one character.");
  }

  const user32 = dlopen("user32.dll", {
    GetAsyncKeyState: { args: ["i32"], returns: "i16" },
    GetForegroundWindow: { args: [], returns: "ptr" },
    GetWindowTextW: { args: ["ptr", "ptr", "i32"], returns: "i32" },
  });
  const { GetAsyncKeyState, GetForegroundWindow, GetWindowTextW } = user32.symbols;
  const titleBuffer = Buffer.alloc(TITLE_CAPACITY * 2);
  let paused = startPaused;
  let toggleWasDown = GetAsyncKeyState(VK_F8) < 0;
  let lastStatus: string | undefined;
  let closed = false;

  function matchesForeground(): boolean {
    if (titlePattern === undefined) return true;

    const window = GetForegroundWindow();
    if (!window) return false;

    const length = GetWindowTextW(window, ptr(titleBuffer), TITLE_CAPACITY);
    return length > 0 && titleBuffer.toString("utf16le", 0, length * 2).toLowerCase().includes(titlePattern);
  }

  return {
    sample(): number {
      if (closed) return 0;

      const toggleDown = GetAsyncKeyState(VK_F8) < 0;
      if (toggleDown && !toggleWasDown) paused = !paused;
      toggleWasDown = toggleDown;

      const active = !paused && matchesForeground();
      let status = "Keyboard capture active. Press F8 to pause.";
      if (paused) {
        status = "Keyboard capture paused. Press F8 to enable.";
      } else if (!active) {
        status = `Keyboard capture paused while ${JSON.stringify(windowTitle)} is out of focus.`;
      }
      if (status !== lastStatus) {
        onStatus(status, { enabled: !paused, active });
        lastStatus = status;
      }
      if (!active) return 0;

      let state = 0;
      for (const { vk, input } of KEYBOARD_BINDINGS) {
        if (GetAsyncKeyState(vk) < 0) state |= input;
      }
      return state;
    },

    close() {
      if (closed) return;
      closed = true;
      user32.close();
    },
  };
}
