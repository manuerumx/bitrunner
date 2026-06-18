import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Repo root = parent of this test/ directory.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Bitburner scripts import each other with game-root absolute paths like
// "/src/lib/utils.js" (home is the root). Node can't resolve those, so map any
// leading-slash specifier onto the real file on disk. Everything else (bare
// "node:test", relative "./x") passes straight through.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("/")) {
    const abs = join(ROOT, specifier);
    return nextResolve(pathToFileURL(abs).href, context);
  }
  return nextResolve(specifier, context);
}
