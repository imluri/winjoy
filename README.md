# WinJoy

Play local co-op games with two keyboards on two Windows PCs. WinJoy creates two virtual Xbox 360 controllers on the PC running the game. The host keyboard drives Player 1. Your friend’s keyboard drives Player 2 over a Bun WebSocket. Steam Remote Play Together can stream the game to your friend. [Steam Remote Play](https://store.steampowered.com/remoteplay)

## Setup

1. Download the Windows x64 installer from the [latest WinJoy release](https://github.com/imluri/winjoy/releases/latest) and run it on both Windows 10/11 x64 PCs. Open **WinJoy** from the Start menu. The installer includes Electron and Bun.
2. On the **host** PC, install ViGEmBus 1.22.0. This is the final release of the retired driver. [ViGEmBus installer](https://github.com/nefarius/ViGEmBus/releases/tag/v1.22.0) · [End-of-life statement](https://docs.nefarius.at/projects/ViGEm/End-of-Life/)
3. Connect both PCs to the same LAN or give your friend access to the host PC over a private VPN. WinJoy’s connection uses plain WebSocket inside that network. Keep the port off the public internet.

### Set up Tailscale on different networks

1. Install Tailscale on both PCs and sign in with your own accounts. Keep both clients connected. [Tailscale for Windows](https://tailscale.com/docs/install/windows)
2. On the host’s Tailscale **Machines** page, use **Share** on the PC running the game and send the share invite privately. Your friend opens it and accepts while signed into their own account. [Share a Tailscale machine](https://tailscale.com/docs/features/sharing)
3. On the host, find the Tailscale IPv4 address in the tray or run `tailscale ip -4`. In WinJoy choose that `100.x.x.x` address as the **Network interface**, leave the port at `4747`, and start hosting. The host's Tailscale tray menu should have **Allow incoming connections** enabled. [Tailscale client preferences](https://tailscale.com/docs/features/client/manage-preferences?tab=windows)
4. Share the WinJoy invite as well. The Tailscale invite enables network access, and the WinJoy invite pairs Player 2. If Tailscale shows a different address for the shared PC on your friend’s account, replace just the address in the WinJoy invite with the one your friend sees.

## Play

1. On the **host**, open **Host** before launching the game. Select the LAN or VPN address your friend can reach, click **Start hosting**, then **Copy invite** and send it to your friend.
2. On the **guest** PC, open **Join**, paste the invite, and click **Join session**. The invite is valid for the current host session.
3. Launch the game on the **host**. For Cuphead, use Steam’s Friends list to send a **Remote Play Together** invite. Leave keyboard and mouse sharing off for your friend so their keyboard goes through WinJoy to Player 2. [Steam Remote Play Together](https://store.steampowered.com/remoteplay#together)
4. Both players press **F8** to enable capture while in the game or stream. In Cuphead, use **J** as the host to confirm with Player 1’s controller, then have your friend press **P** or **J** on the world map to join as Mugman.

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

Capture starts paused on both PCs. **F8** toggles it system-wide. Press it again before typing in other apps. Use **Stop session** to disconnect.

**Latency** on the session screen shows the round-trip time of the WinJoy connection. Steam streaming has its own delay. WinJoy checks GitHub for a new stable release at startup, downloads and verifies the installer, and offers **Install update** in **Updates**. Installing closes WinJoy and opens Windows Setup.

### Troubleshooting

- **Guest cannot connect.** Confirm the current invite uses the host's reachable address. In PowerShell on the guest, replace the example IP in `tailscale ping 100.101.102.103` and `Test-NetConnection 100.101.102.103 -Port 4747` with the shared host address. Run the TCP check while the host is running WinJoy. If Tailscale connects and the TCP check fails, check the bind address, tailnet policy, and Windows Firewall. If you add a firewall rule on the host, scope inbound TCP `4747` to the host’s local Tailscale address and the friend’s remote Tailscale address. [Tailscale TCP troubleshooting](https://tailscale.com/docs/reference/troubleshooting/network-configuration/tcp-connection-two-devices) · [Windows Firewall PowerShell reference](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule)
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
