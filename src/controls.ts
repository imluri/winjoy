const INPUT = {
  up: 0x0001,
  down: 0x0002,
  left: 0x0004,
  right: 0x0008,
  start: 0x0010,
  leftBumper: 0x0100,
  rightBumper: 0x0200,
  a: 0x1000,
  b: 0x2000,
  x: 0x4000,
  y: 0x8000,
} as const;

const MOVEMENT_MASK = INPUT.up | INPUT.down | INPUT.left | INPUT.right;

export const INPUT_MASK = Object.values(INPUT).reduce((mask, bit) => mask | bit, 0);

export const KEYBOARD_BINDINGS = [
  { key: "W", input: INPUT.up, name: "Move up" },
  { key: "A", input: INPUT.left, name: "Move left" },
  { key: "S", input: INPUT.down, name: "Move down" },
  { key: "D", input: INPUT.right, name: "Move right" },
  { key: "J", input: INPUT.a, name: "Jump or confirm (A)" },
  { key: "K", input: INPUT.x, name: "Shoot (X)" },
  { key: "L", input: INPUT.y, name: "Dash (Y)" },
  { key: "U", input: INPUT.b, name: "EX shot or back (B)" },
  { key: "I", input: INPUT.leftBumper, name: "Switch weapon (LB)" },
  { key: "O", input: INPUT.rightBumper, name: "Lock aim (RB)" },
  { key: "P", input: INPUT.start, name: "Pause or join (Start)" },
].map((binding) => ({ ...binding, vk: binding.key.charCodeAt(0) }));

export interface ControllerReport {
  buttons: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lt: number;
  rt: number;
}

export function toReport(state: number): ControllerReport {
  const horizontal = Number(Boolean(state & INPUT.right)) - Number(Boolean(state & INPUT.left));
  const vertical = Number(Boolean(state & INPUT.up)) - Number(Boolean(state & INPUT.down));
  const magnitude = horizontal && vertical ? 23_170 : 32_767;

  return {
    buttons: state & (INPUT_MASK ^ MOVEMENT_MASK),
    lx: horizontal * magnitude,
    ly: vertical * magnitude,
    rx: 0,
    ry: 0,
    lt: 0,
    rt: 0,
  };
}
