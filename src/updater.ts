import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const REPOSITORY = "imluri/winjoy";
const LATEST_RELEASE = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const ASSET_HOSTS = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const MAX_BYTES = 512 * 1024 * 1024;

export type UpdateRequest = { currentVersion: string; cacheDir: string };
export type StagedInstaller = { path: string; sha256: string; version: string };
export type UpdateResult = {
  phase: "current" | "available" | "downloading" | "ready" | "error";
  status: string;
  version?: string;
  progress?: number;
  installer?: StagedInstaller;
};

function versionParts(version: unknown) {
  if (typeof version !== "string" || !/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(version)) return;
  return version.split(".").map(Number);
}

export function readUpdateRequest(input: Record<string, unknown>): UpdateRequest {
  const { currentVersion, cacheDir } = input;
  if (typeof currentVersion !== "string" || !versionParts(currentVersion) || typeof cacheDir !== "string" || !isAbsolute(cacheDir)) {
    throw new Error("WinJoy could not start its update check.");
  }
  return { currentVersion, cacheDir };
}

async function assetResponse(url: string, signal: AbortSignal, fetcher: typeof fetch) {
  let endpoint = new URL(url);
  for (let remaining = 4; remaining > 0; remaining--) {
    if (endpoint.protocol !== "https:" || !ASSET_HOSTS.has(endpoint.hostname) || endpoint.port || endpoint.username || endpoint.password) {
      throw new Error("GitHub returned an unexpected installer download address.");
    }
    const response = await fetcher(endpoint, { signal, redirect: "manual" });
    if (response.status === 200 && response.body) return response.body;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      throw new Error("GitHub could not provide the installer. Try again later.");
    }
    endpoint = new URL(location, endpoint);
  }
  throw new Error("GitHub redirected the installer download too many times.");
}

async function matchesInstaller(installer: StagedInstaller, size: number, signal: AbortSignal) {
  try {
    if ((await stat(installer.path)).size !== size) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(installer.path, { signal })) hash.update(chunk);
    return hash.digest("hex") === installer.sha256;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

export async function checkForUpdate(
  request: UpdateRequest,
  publish: (state: UpdateResult) => void,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(LATEST_RELEASE, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    redirect: "error",
    headers: { Accept: "application/vnd.github+json", "User-Agent": `WinJoy/${request.currentVersion}` },
  });
  if (!response.ok) throw new Error(`GitHub update check failed (HTTP ${response.status}). Try again later.`);
  const release = await response.json() as {
    tag_name?: string;
    draft?: boolean;
    prerelease?: boolean;
    assets?: { state?: string; name?: string; digest?: string; size?: number }[];
  } | null;
  const tag = release?.tag_name;
  const version = typeof tag === "string" && tag.startsWith("v") ? tag.slice(1) : "";
  const offered = versionParts(version);
  const installed = versionParts(request.currentVersion);
  if (!offered || !installed || release?.draft !== false || release.prerelease !== false) {
    throw new Error("GitHub did not return a valid stable WinJoy release.");
  }
  const difference = offered.findIndex((part, index) => part !== installed[index]);
  if (difference === -1 || offered[difference] < installed[difference]) {
    publish({ phase: "current", status: "WinJoy is up to date." });
    return;
  }

  const name = `WinJoy-Setup-${version}-x64.exe`;
  const asset = Array.isArray(release.assets) ? release.assets.find((item) => item?.name === name) : undefined;
  const digest = asset?.digest;
  const size = asset?.size;
  if (asset?.state !== "uploaded" || typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/i.test(digest) ||
      typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES) {
    throw new Error("This WinJoy release is missing a verified Windows installer.");
  }

  const installer = { path: join(request.cacheDir, name), sha256: digest.slice(7).toLowerCase(), version };
  const ready = () => publish({ phase: "ready", version, progress: 100, status: "The verified update is ready to install.", installer });
  publish({ phase: "available", version, status: `WinJoy ${version} is available.` });
  if (await matchesInstaller(installer, size, signal)) return ready();

  await mkdir(request.cacheDir, { recursive: true });
  const partial = join(request.cacheDir, `${name}.${randomUUID()}.part`);
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]);
  let bytes = 0;
  let progress = 0;
  const hash = createHash("sha256");
  const downloading = () => publish({ phase: "downloading", version, progress, status: `Downloading WinJoy ${version}…` });
  downloading();
  try {
    const body = await assetResponse(`https://github.com/${REPOSITORY}/releases/download/${tag}/${name}`, timeout, fetcher);
    const writer = await open(partial, "wx");
    try {
      for await (const chunk of body) {
        timeout.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > size) throw new Error("The installer is larger than the size published by GitHub.");
        hash.update(chunk);
        await writer.writeFile(chunk);
        const next = Math.min(99, Math.floor(bytes * 100 / size));
        if (next > progress) {
          progress = next;
          downloading();
        }
      }
    } finally {
      await writer.close();
    }
    if (bytes !== size || hash.digest("hex") !== installer.sha256) {
      throw new Error("The downloaded installer failed SHA-256 verification. Try again.");
    }
    timeout.throwIfAborted();
    await rename(partial, installer.path);
    ready();
  } finally {
    await unlink(partial).catch(() => {});
  }
}
