import { expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { launchUpdateInstaller } = require("./update-install.cjs");

async function withStagedInstaller(testCase: (fixture: {
  path: string;
  sha256: string;
  version: string;
}, stagingDirectory: string) => Promise<void>) {
  const stagingDirectory = await mkdtemp(join(tmpdir(), "winjoy-installer-test-"));
  const path = join(stagingDirectory, "WinJoy-Setup-0.2.0-x64.exe");
  try {
    const contents = "WinJoy installer fixture";
    await writeFile(path, contents);
    await testCase({
      path,
      sha256: createHash("sha256").update(contents).digest("hex"),
      version: "v0.2.0",
    }, stagingDirectory);
  } finally {
    await rm(path, { force: true });
    await rmdir(stagingDirectory);
  }
}

test("starts the verified staged installer directly and supplies the current PID", async () => {
  await withStagedInstaller(async (fixture, stagingDirectory) => {
    const unref = mock();
    const child = Object.assign(new EventEmitter(), { unref });
    const spawnChild = mock((_path: string, _args: string[], _options: object) => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    await launchUpdateInstaller(fixture, { stagingDirectory, spawnChild });

    expect(spawnChild).toHaveBeenCalledWith(
      fixture.path,
      ["/WAITPID=" + process.pid],
      { cwd: stagingDirectory, detached: true, shell: false, stdio: "ignore", windowsHide: false },
    );
    expect(unref).toHaveBeenCalledTimes(1);
  });
});

test("rejects a staged executable with the wrong release name or checksum", async () => {
  await withStagedInstaller(async (fixture, stagingDirectory) => {
    const spawnChild = mock();
    const options = { stagingDirectory, spawnChild };
    await expect(launchUpdateInstaller({ ...fixture, version: "0.2.1" }, options))
      .rejects.toThrow("does not match the staged WinJoy release");
    await writeFile(fixture.path, "modified after download");
    await expect(launchUpdateInstaller(fixture, options)).rejects.toThrow("checksum changed");
    expect(spawnChild).not.toHaveBeenCalled();
  });
});

test("reports installer launch failure so the app can stay open for a retry", async () => {
  await withStagedInstaller(async (fixture, stagingDirectory) => {
    const child = Object.assign(new EventEmitter(), { unref: mock() });
    const spawnChild = () => {
      queueMicrotask(() => child.emit("error", new Error("Launch blocked")));
      return child;
    };

    await expect(launchUpdateInstaller(fixture, { stagingDirectory, spawnChild }))
      .rejects.toThrow("Could not launch the update installer");
    expect(child.unref).not.toHaveBeenCalled();
  });
});
