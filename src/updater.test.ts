import { afterEach, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkForUpdate, type UpdateResult } from "./updater.ts";

const version = "0.2.1";
const asset = `WinJoy-Setup-${version}-x64.exe`;
const chunks = [Buffer.from("Windows"), Buffer.from(" installer")];
const bytes = Buffer.concat(chunks);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const digest = `sha256:${sha256}`;
const temporary: string[] = [];

async function fixture(currentVersion = "0.2.0") {
  const cacheDir = await mkdtemp(join(tmpdir(), "winjoy-updater-"));
  temporary.push(cacheDir);
  const states: UpdateResult[] = [];
  const check = (fetcher: unknown) => checkForUpdate({ currentVersion, cacheDir }, (state) => states.push(state),
    new AbortController().signal, fetcher as typeof fetch);
  return { cacheDir, states, check };
}

function release(assetDigest = digest) {
  return Response.json({ tag_name: `v${version}`, draft: false, prerelease: false,
    assets: [{ state: "uploaded", name: asset, digest: assetDigest, size: bytes.length }] });
}

afterEach(async () => {
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

test("downloads from the GitHub asset host, verifies chunks and reuses the verified cache", async () => {
  const { states, check, cacheDir } = await fixture();
  const fetcher = mock(async (input: string | URL) => {
    const url = new URL(input);
    if (url.hostname === "api.github.com") return release();
    if (url.hostname === "github.com") return Response.redirect("https://release-assets.githubusercontent.com/test");
    return new Response(new ReadableStream({ start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    } }));
  });

  await check(fetcher);
  const path = join(cacheDir, asset);
  expect(states.at(-1)).toMatchObject({ phase: "ready", progress: 100, installer: { path, version, sha256 } });
  expect(await Bun.file(path).text()).toBe(bytes.toString());
  expect(await readdir(cacheDir)).toEqual([asset]);
  expect(fetcher).toHaveBeenCalledTimes(3);
  await check(fetcher);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(states.at(-1)?.phase).toBe("ready");
});

test("does not offer a GitHub release older than the installed version", async () => {
  const { states, check } = await fixture("0.3.0");
  await check(async () => release());
  expect(states.map(({ phase }) => phase)).toEqual(["current"]);
});

test("rejects unexpected download hosts and discards invalid partial downloads", async () => {
  const { states, check, cacheDir } = await fixture();
  await expect(check(async (input: string | URL) => new URL(input).hostname === "api.github.com"
    ? release() : Response.redirect("https://example.com/installer"))).rejects.toThrow("unexpected installer download address");
  await expect(check(async (input: string | URL) => new URL(input).hostname === "api.github.com"
    ? release("sha256:" + "0".repeat(64)) : new Response(bytes))).rejects.toThrow("failed SHA-256 verification");
  expect(states.some(({ phase }) => phase === "ready")).toBe(false);
  expect(await readdir(cacheDir)).toEqual([]);
});
