import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  artifactLocations,
  artifactVersion,
  repositoryRoot,
  run, runWorkflow, log,
} from "./DeploymentUtilities.mjs";

/**
 * Prepares the archive consumed by `code:deploy`, using the package version
 * to choose its output directory. Compiled modules and locked production
 * dependencies are staged together so Lambda can resolve their imports.
 * The module list must track changes to the compiled directory layout.
 * A temporary installation keeps development dependencies out of the ZIP
 * and is removed after packaging, including when installation or zip fails.
 */
function packageLambda() {
  const version = artifactVersion();
  const artifact = artifactLocations(version);
  const distDirectory = path.join(repositoryRoot, "dist");

  run("npm", ["run", "build"]);
  mkdirSync(artifact.directory, { recursive: true });
  const stagingDirectory = mkdtempSync(path.join(tmpdir(), "agentic-lambda-"));
  try {
    const modules = [
      "index.js", "github/GithubTypes.js", "github/GithubWebhook.js",
      "github/GithubWebhookParser.js", "github/GithubWebhookSignature.js",
      "ping/PingEndpoint.js", "shared/http.js", "shared/Logger.js",
      "requests/TrackedRequest.js", "aws/DynamoService.js",
      "provision/ProvisionEndpoint.js", "aws/EventBridgeService.js",
    ];
    for (const module of modules)
      cpSync(path.join(distDirectory, module), path.join(stagingDirectory, module));
    for (const manifest of ["package.json", "package-lock.json"])
      cpSync(path.join(repositoryRoot, manifest), path.join(stagingDirectory, manifest));
    run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: stagingDirectory,
    });
    run("zip", ["-q", "-FS", "-r", artifact.archivePath, ...modules, "node_modules"], {
      cwd: stagingDirectory,
    });
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
  log("info", "artifact.packaged", { version, archivePath: artifact.archivePath });
}

runWorkflow("package", packageLambda);
