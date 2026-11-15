import { existsSync } from "node:fs";
import { readdir, mkdir, mkdtemp, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Build the WinJoy installer using x64 Bun on Windows.");
}

const project = await realpath(resolve(import.meta.dir, ".."));
const dist = join(project, "dist");
const payload = join(dist, "WinJoy");
const version: string = (await Bun.file(join(project, "package.json")).json()).version;
const parts = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?$/.exec(version)?.slice(1);
if (!parts || parts.some((part) => Number(part) > 65_535)) {
  throw new Error("WinJoy's version must fit a three-part Windows file version.");
}

const override = process.env.WINJOY_MAKENSIS;
const compiler = override ? resolve(project, override) : Bun.which("makensis.exe");
if (!compiler) throw new Error("Install NSIS 3.13 and add makensis.exe to PATH or set WINJOY_MAKENSIS.");
if (!(await Bun.file(join(payload, "WinJoy.exe")).exists())) {
  throw new Error("Run bun run package:windows before building the installer.");
}
if (relative(payload, await realpath(payload)) !== "") {
  throw new Error(`Packaging requires a regular directory at ${payload}.`);
}

const removal: string[] = [];
let payloadBytes = 0;

async function collectFiles(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const filename = join(directory, entry.name);
    const uninstallPath = "$INSTDIR\\" + relative(payload, filename).replaceAll("$", () => "$$");
    if (entry.isDirectory()) {
      await collectFiles(filename);
      removal.push(`RMDir "${uninstallPath}"`);
    } else if (entry.isFile()) {
      payloadBytes += (await stat(filename)).size;
      removal.push(`Delete "${uninstallPath}"`);
    } else {
      throw new Error(`Installer payload contains an unsupported entry at ${filename}.`);
    }
  }
}

await collectFiles(payload);
const staging = await mkdtemp(join(dist, ".winjoy-installer-"));
const uninstallList = join(staging, "uninstall.nsh");
const filename = `WinJoy-Setup-${version}-x64.exe`;
const built = join(staging, filename);
const output = join(dist, filename);

try {
  await writeFile(uninstallList, removal.join("\n") + "\n", "utf8");
  const compilerDirectory = dirname(compiler);
  const env = { ...process.env };
  if (!env.NSISDIR && existsSync(join(compilerDirectory, "Stubs"))) env.NSISDIR = compilerDirectory;
  const job = Bun.spawn([
    compiler,
    `/DWINJOY_VERSION=${version}`,
    `/DWINJOY_FILE_VERSION=${[...parts, "0"].join(".")}`,
    `/DWINJOY_KIB=${Math.ceil(payloadBytes / 1024)}`,
    `/DWINJOY_PAYLOAD=${payload}`,
    `/DWINJOY_UNINSTALL=${uninstallList}`,
    `/DWINJOY_OUTPUT=${built}`,
    join(import.meta.dir, "winjoy.nsi"),
  ], { cwd: project, env, stdout: "inherit", stderr: "inherit" });

  const code = await job.exited;
  if (code !== 0 || !(await Bun.file(built).exists())) {
    throw new Error(`NSIS couldn't build the WinJoy installer (exit ${code}).`);
  }
  await rename(built, output);
} finally {
  if (relative(staging, await realpath(staging)) === "") {
    await rm(staging, { recursive: true, force: true, maxRetries: 3 });
  }
}

console.log(`Built ${output}`);
