// Vendors NoatToan/contributor-box (feedback widget, contributor board, admin review) into this
// repo: `pnpm contributor:sync`. Reads `contributor-box.config.json` (upstream, ref, target paths,
// migration numbering), shallow-clones `upstream@ref` with your git credentials (the repo is
// private), and runs that checkout's `scripts/sync.mjs`. See docs/product/ARCHITECTURE.md D14.
//
//   pnpm contributor:sync                       # clone upstream@ref and copy
//   pnpm contributor:sync -- --source ../contributor-box   # use a local checkout instead
//   pnpm contributor:sync -- --check            # fail if the vendored copy differs from upstream@ref
//   pnpm contributor:sync -- --ref <sha|tag>    # sync a specific commit/tag (then commit the lock)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(path.join(root, "contributor-box.config.json"), "utf8"));
const args = process.argv.slice(2).filter((a) => a !== "--");
const take = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const [, value] = args.splice(i, 2);
  return value;
};

let source = take("--source");
const ref = take("--ref") ?? config.ref;
let tmp;
if (!source) {
  tmp = mkdtempSync(path.join(tmpdir(), "contributor-box-"));
  source = tmp;
  execFileSync("git", ["init", "-q", source], { stdio: "inherit" });
  execFileSync("git", ["-C", source, "fetch", "-q", "--depth", "1", config.upstream, ref], { stdio: "inherit" });
  execFileSync("git", ["-C", source, "checkout", "-q", "FETCH_HEAD"], { stdio: "inherit" });
}
try {
  execFileSync(
    process.execPath,
    [path.join(source, "scripts", "sync.mjs"), "--host", root, "--source", path.resolve(source), ...args],
    { stdio: "inherit" },
  );
} finally {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}
