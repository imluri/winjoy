import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Package WinJoy using x64 Bun on Windows.");
}

const project = await realpath(resolve(import.meta.dir, ".."));
const dist = join(project, "dist");
const output = join(dist, "WinJoy");
const renderer = join(dist, "renderer");
const electronSource = resolve(project, process.env.WINJOY_ELECTRON_DIST || "node_modules/electron/dist");
const sourceIsZip = extname(electronSource).toLowerCase() === ".zip";
const bunBaseline = process.env.WINJOY_BUN_BASELINE;
const vigem = join(project, "node_modules", "vigemclient");
const vigemDll = join(vigem, "native", "x64", "ViGEmClient.dll");
const main = "electron/main.cjs";
const preload = "electron/preload.cjs";

if (!existsSync(sourceIsZip ? electronSource : join(electronSource, "electron.exe"))) {
  throw new Error("Install the Electron binary or set WINJOY_ELECTRON_DIST to its Windows x64 ZIP or extracted folder.");
}
if (!existsSync(vigemDll)) {
  throw new Error("ViGEmClient.dll is missing. Run bun install --ignore-scripts first.");
}
if (bunBaseline && !existsSync(resolve(project, bunBaseline))) {
  throw new Error("WINJOY_BUN_BASELINE must be the path to a Windows x64 baseline Bun executable.");
}

async function run(arguments_: string[]) {
  const command = Bun.spawn(arguments_, { cwd: project, stdout: "inherit", stderr: "inherit" });
  const code = await command.exited;
  if (code !== 0) throw new Error(`Packaging command exited with status ${code}: ${arguments_.join(" ")}`);
}

async function verifyPath(path: string) {
  if (relative(path, await realpath(path)) !== "") {
    throw new Error(`Packaging requires a regular directory at ${path}.`);
  }
}

await mkdir(dist, { recursive: true });
await verifyPath(dist);
if (existsSync(renderer)) {
  await verifyPath(renderer);
  await rm(renderer, { recursive: true });
}
await run([process.execPath, "run", "build"]);

const staging = await mkdtemp(join(dist, ".winjoy-package-"));
const next = join(staging, "WinJoy");
const previous = join(staging, "previous");
let preservePrevious = false;

try {
  if (sourceIsZip) {
    await mkdir(next);
    await run(["tar.exe", "-xf", electronSource, "-C", next]);
  } else {
    await cp(electronSource, next, { recursive: true });
  }

  await rename(join(next, "electron.exe"), join(next, "WinJoy.exe"));
  const crashReporter = join(next, "electron_wer.dll");
  if (existsSync(crashReporter)) await rename(crashReporter, join(next, "WinJoy_wer.dll"));
  await copyFile(join(project, "README.md"), join(next, "WinJoy README.md"));

  const app = join(next, "resources", "app");
  const binary = join(next, "resources", "bin");
  await mkdir(join(app, "electron"), { recursive: true });
  await mkdir(join(app, "dist"), { recursive: true });
  await mkdir(binary, { recursive: true });
  await copyFile(join(project, main), join(app, main));
  await copyFile(join(project, preload), join(app, preload));
  await cp(renderer, join(app, "dist", "renderer"), { recursive: true });
  const manifest = await Bun.file(join(project, "package.json")).json() as { name: string; version: string };
  await writeFile(join(app, "package.json"), JSON.stringify({
    name: manifest.name,
    productName: "WinJoy",
    version: manifest.version,
    main,
  }, null, 2) + "\n");

  const appLicense = join(project, "LICENSE");
  if (existsSync(appLicense)) await copyFile(appLicense, join(app, "LICENSE"));
  const notices = join(project, "licenses");
  if (existsSync(notices)) await cp(notices, join(app, "licenses"), { recursive: true });
  await copyFile(vigemDll, join(binary, "ViGEmClient.dll"));
  await copyFile(join(vigem, "LICENSE"), join(binary, "vigemclient-LICENSE.txt"));
  const compile = [
    process.execPath, "build", "src/worker.ts", "--compile", "--minify",
    "--target=bun-windows-x64-baseline", "--outfile", join(binary, "winjoy-worker.exe"),
  ];
  if (bunBaseline) compile.push(`--compile-executable-path=${resolve(project, bunBaseline)}`);
  await run(compile);

  await verifyPath(next);
  if (existsSync(output)) {
    await verifyPath(output);
    await rename(output, previous);
    preservePrevious = true;
  }

  try {
    await rename(next, output);
    preservePrevious = false;
  } catch (error) {
    if (preservePrevious) {
      try {
        await rename(previous, output);
        preservePrevious = false;
      } catch (cause) {
        throw new Error(`Couldn't replace ${output}. The previous package is at ${previous}.`, { cause });
      }
    }
    throw error;
  }
} finally {
  if (!preservePrevious) {
    await verifyPath(staging);
    await rm(staging, { recursive: true, force: true, maxRetries: 3 });
  }
}

console.log(`Packaged WinJoy at ${join(output, "WinJoy.exe")}`);
