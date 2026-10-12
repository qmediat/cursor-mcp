// A fake `cursor-agent` for the tests: an executable script in a directory of its own, first on a PATH. POSIX only (a
// script with a shebang), so every test that runs it passes { skip: FAKE_AGENT_SKIP }.
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/** Why a test that runs the fake is skipped here (Windows runs no shebang script), or false. */
export const FAKE_AGENT_SKIP =
  process.platform === "win32" ? "the fake cursor-agent is a shebang script (POSIX)" : false;

/** A fresh directory for the fake: `write(source)` (re)writes the executable, `path` is a PATH with the fake first,
 * `remove()` deletes the directory (a suite calls it in `after`). */
export async function fakeAgentDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const bin = join(dir, "cursor-agent");
  const write = async (source) => {
    await writeFile(bin, source);
    await chmod(bin, 0o755);
  };
  const remove = () => rm(dir, { recursive: true, force: true });
  return { dir, bin, path: `${dir}${delimiter}${process.env.PATH}`, write, remove };
}
