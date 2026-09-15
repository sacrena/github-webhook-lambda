import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  artifactLocations, artifactVersion, repositoryRoot, run,
} from "./DeploymentUtilities.mjs";

/**
 * Prepares the archive consumed by `code:deploy`, using the package version
 * to choose its output directory. The archive is rooted at `dist` so Lambda
 * can resolve the entry point's relative imports after extraction. Its module
 * list must track changes to the compiled directory layout. Compilation must
 * succeed before zip synchronizes the archive with the selected build files.
 */
function packageLambda() {
  const version = artifactVersion();
  const artifact = artifactLocations(version);
  const distDirectory = path.join(repositoryRoot, "dist");

  run("npm", ["run", "build"]);
  mkdirSync(artifact.directory, { recursive: true });
  run("zip", [
    "-FS", "-r", path.relative(distDirectory, artifact.archivePath),
    "index.js",
    "github/GithubTypes.js", "github/GithubWebhook.js", "github/GithubWebhookParser.js",
    "ping/PingEndpoint.js", "shared/http.js",
  ], { cwd: distDirectory });
}

packageLambda();
