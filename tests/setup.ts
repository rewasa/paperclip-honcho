import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

process.env.NODE_ENV = "test";

// Hermeticity: the local Honcho config fallback reads ~/.honcho/config.json via
// os.homedir(). Redirect HOME (which os.homedir() honors on POSIX) to a fresh,
// empty temp directory so the suite never reads the developer's real Honcho
// config. Tests that exercise the fallback write their own config under HOME.
if (typeof os.tmpdir === "function" && typeof fs.mkdtempSync === "function") {
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "honcho-test-home-"));
  process.env.HOME = isolatedHome;
  delete process.env.HERMES_HOME;
}
