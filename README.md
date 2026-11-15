# WinJoy

Play Cuphead’s local co-op with two keyboards on two Windows PCs. WinJoy creates two virtual Xbox 360 controllers on the PC running Cuphead. Your keyboard drives Player 1, and your friend’s keyboard drives Player 2 over a Bun WebSocket. Steam Remote Play Together streams the game to your friend. [Cuphead on Steam](https://store.steampowered.com/app/268910/Cuphead/) · [Steam Remote Play](https://store.steampowered.com/remoteplay)

## Setup

1. Download the Windows x64 installer from the [latest WinJoy release](https://github.com/imluri/winjoy/releases/latest) and run it on both Windows 10/11 x64 PCs. Open **WinJoy** from the Start menu. The installer includes Electron and Bun.
2. On the **host** PC, install ViGEmBus 1.22.0. This is the final release of the retired driver. [ViGEmBus installer](https://github.com/nefarius/ViGEmBus/releases/tag/v1.22.0) · [End-of-life statement](https://docs.nefarius.at/projects/ViGEm/End-of-Life/)
3. Put both PCs on the same LAN. For two locations, use a private VPN that gives your friend access to the host PC. Use the host PC’s LAN or VPN IPv4 address in the next step. WinJoy’s direct connection uses plain WebSocket inside that network. Keep the port off the public internet. [Tailscale quickstart](https://tailscale.com/docs/how-to/quickstart)

## Play

1. On the **host**, open **Host** before launching Cuphead. Select the LAN or VPN address your friend can reach, click **Start hosting**, then **Copy invite** and send it to your friend.
2. On the **guest** PC, open **Join**, paste the invite, and click **Join session**. The invite is valid for the current host session.
3. On the **host**, launch Cuphead and invite your friend via Steam Remote Play Together. Leave keyboard and mouse sharing disabled for the guest so their keyboard goes through WinJoy to Player 2. Use **J** to confirm with Player 1’s controller.
4. On the **guest** PC, focus the Steam stream and press **F8** to enable capture. Press **P** or **J** on the world map to join as Mugman. Press **F8** again before switching away from the stream.

### Default keys

| Keyboard | Xbox 360 input | Cuphead action |
| --- | --- | --- |
| W A S D | Left stick | Move |
| J | A | Jump / confirm |
| K | X | Shoot |
| L | Y | Dash |
| U | B | EX shot / back |
| I | LB | Switch weapon |
| O | RB | Lock aim |
| P | Start | Join / pause |
| F8 | | Toggle WinJoy keyboard capture |

The host captures keys when the foreground window’s title contains `Cuphead` by default. Change **Game window** on the Host page for a different title. The guest can fill in **Capture window** to restrict capture to their stream. With that field blank, the mapped keys work across windows whenever capture is enabled. Use **Stop session** to disconnect.

### Troubleshooting

- **Guest cannot connect.** Check that the host picked their LAN or VPN address and sent an invite from the current session. From the guest’s PC, `Test-NetConnection <HOST_IP> -Port 4747` checks reachability on the default port. If Windows Firewall is blocking it, allow inbound TCP on that port for the private connection.
- **Cuphead sees only one controller.** With WinJoy running, press **Win+R**, enter `joy.cpl`, and check that Windows lists two Xbox 360 controllers. Close other controller emulators and start WinJoy before Cuphead. On Cuphead’s control screen, assign the first controller if you already entered using the keyboard.
- **Host keys trigger extra actions.** WinJoy reads the mapped keys while Windows still delivers them to the game. If you’ve remapped Cuphead’s keyboard bindings to any WinJoy keys, restore the game’s default keyboard bindings or choose different keys in `src/controls.ts`.

## Development

Use Bun 1.4.4 or newer and Node.js 22.12 or newer to run the template’s Electron launcher from source. Electron downloads its Windows binary on first launch. The `vigemclient` package supplies the native DLL with package scripts disabled. [Bun installation](https://bun.com/docs/installation) · [Desktop UI Template](https://github.com/imluri/desktop-ui-template)

```powershell
bun install --frozen-lockfile --ignore-scripts
bun run desktop
bun run typecheck
bun test
```

Run `bun run package:windows` to build `dist/WinJoy/WinJoy.exe`. Set `WINJOY_ELECTRON_DIST` to an official Windows x64 Electron ZIP or extracted directory to use it for packaging. Set `WINJOY_BUN_BASELINE` to a compatible Windows x64 baseline Bun executable to reuse it for the standalone worker. The command-line entry point is also available with `bun start --help`.

To build the Windows installer, install NSIS 3.13 and put `makensis.exe` on PATH or point `WINJOY_MAKENSIS` to it. Run `bun run package:windows`, then `bun run package:installer`. The setup executable is written to `dist/`. Setup installs WinJoy for the current user and adds a Start menu shortcut and an entry in **Installed apps**. [NSIS](https://nsis.sourceforge.io/Download)

The Electron window talks to the Bun worker over local process pipes. Bun handles the HTTP upgrade, authentication, and both ends of the WebSocket. The host keeps both controllers attached and releases Player 2’s controls if the guest drops out. Windows keyboard capture and virtual controller updates use Bun FFI. [Netpad](https://github.com/imluri/netpad)
