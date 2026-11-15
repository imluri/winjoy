import { dlopen } from "bun:ffi";
import { KEYBOARD_BINDINGS } from "./controls.ts";

const VK_F8 = 0x77;

export function openKeyboard(
  onStatus: (message: string, capture: { enabled: boolean; active: boolean }) => void = (message) => console.log(message),
) {
  if (process.platform !== "win32") {
    throw new Error("WinJoy keyboard capture requires Windows.");
  }

  const user32 = dlopen("user32.dll", {
    GetAsyncKeyState: { args: ["i32"], returns: "i16" },
  });
  const { GetAsyncKeyState } = user32.symbols;
  let paused = true;
  let toggleWasDown = GetAsyncKeyState(VK_F8) < 0;
  let lastStatus: string | undefined;
  let closed = false;

  return {
    sample(): number {
      if (closed) return 0;

      const toggleDown = GetAsyncKeyState(VK_F8) < 0;
      if (toggleDown && !toggleWasDown) paused = !paused;
      toggleWasDown = toggleDown;

      const status = paused ? "Keyboard capture paused. Press F8 to enable." : "Keyboard capture active. Press F8 to pause.";
      if (status !== lastStatus) {
        onStatus(status, { enabled: !paused, active: !paused });
        lastStatus = status;
      }
      if (paused) return 0;

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
