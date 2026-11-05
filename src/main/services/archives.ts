import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FileEntry } from "@shared/types/files";
import { AppError } from "../utils/errors";
import { toFileEntry, withNumericSuffix } from "./fs-core";

/**
 * Archive creation and extraction via the system `ditto` binary (fixed
 * path, argv-array arguments — no shell, nothing user-controlled is
 * interpolated into a command string). v1 supports zip only; ditto both
 * creates and extracts Apple-safe zips, including resource forks.
 */

const DITTO = "/usr/bin/ditto";

function ditto(args: string[], timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      DITTO,
      args,
      { timeout: timeoutMs, shell: false, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new AppError("UNKNOWN", stderr?.trim() || "ditto failed."));
        } else {
          resolve();
        }
      },
    );
  });
}

/** Zip the selected items into "name.zip" beside the first item. */
export async function compressItems(paths: string[]): Promise<FileEntry> {
  const first = paths[0];
  const dir = path.dirname(first);
  const base = path.basename(first);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  let target = path.join(dir, `${stem}.zip`);
  if (
    await fsp.lstat(target).then(
      () => true,
      () => false,
    )
  ) {
    target = withNumericSuffix(target);
  }
  // `--keepParent` only makes sense for folders; files land at the zip root.
  const args = ["-c", "-k", "--sequesterRsrc"];
  for (const p of paths) {
    const stat = await fsp.lstat(p);
    if (stat.isDirectory()) args.push("--keepParent");
    args.push(p);
  }
  args.push(target);
  await ditto(args);
  return toFileEntry(target);
}

/** Extract a .zip into an auto-named folder beside it. */
export async function extractArchive(archivePath: string): Promise<FileEntry> {
  if (!archivePath.toLowerCase().endsWith(".zip")) {
    throw new AppError(
      "UNSUPPORTED",
      "Only .zip archives can be extracted right now.",
    );
  }
  const dir = path.dirname(archivePath);
  const stem = path.basename(archivePath).replace(/\.zip$/i, "");
  const candidates = [stem];
  for (let i = 2; i < 1000; i++) candidates.push(`${stem} ${i}`);
  let target: string | null = null;
  for (const candidate of candidates) {
    const full = path.join(dir, candidate);
    const exists = await fsp.lstat(full).then(
      () => true,
      () => false,
    );
    if (!exists) {
      target = full;
      break;
    }
  }
  if (!target)
    throw new AppError("CONFLICT", "Could not find an unused folder name.");
  await fsp.mkdir(target);
  try {
    await ditto(["-x", "-k", archivePath, target]);
  } catch (error) {
    // Leave nothing broken behind.
    await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return toFileEntry(target);
}
