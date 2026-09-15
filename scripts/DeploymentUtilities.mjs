import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { log, withLogContext } from "../src/shared/Logger.js";

export { log } from "../src/shared/Logger.js";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const awsSettings = {
  profile: process.env.AWS_PROFILE ?? "sso-local-profile",
  region: process.env.AWS_REGION ?? "us-east-1",
};

/**
 * Supplies the package version used by packaging and deployment to agree on
 * an artifact location. Metadata is read relative to the repository rather
 * than the invoking process, allowing the scripts to run from other directories.
 * Callers rely on package.json containing a usable version; this helper parses
 * the file but does not validate the presence or format of that property.
 *
 * @returns {string} The package version used in artifact paths and object keys.
 * @throws If package.json cannot be read or parsed as JSON.
 */
export function artifactVersion() {
  const packagePath = path.join(repositoryRoot, "package.json");
  const packageMetadata = readFileSync(packagePath, "utf8");
  return JSON.parse(packageMetadata).version;
}

/**
 * Defines the shared naming convention that connects the package archive to
 * its S3 object. Packaging uses the absolute directory and archive path, while
 * upload and stack deployment use the matching bucket-relative key. Keeping
 * these values together prevents a naming change from separating the build
 * output from the object that CloudFormation is instructed to deploy.
 *
 * @param {string} version Package version used to identify the artifact.
 * @returns {{directory: string, archivePath: string, key: string}} Local paths and S3 key.
 */
export function artifactLocations(version) {
  const directory = path.join(repositoryRoot, "output", `v${version}`);
  return {
    directory,
    archivePath: path.join(directory, "lambda.zip"),
    key: `v${version}/lambda.zip`,
  };
}

/**
 * Resolves the infrastructure-owned destination used by upload and deployment.
 * The configured environment must contain the `agentic-setup-s3` stack with
 * an ArtifactBucketName output. AWS stdout is captured so the lookup cannot
 * contaminate the upload script's version output, while stderr remains visible.
 * The returned text is trimmed but is not checked for a missing stack output.
 *
 * @returns {string} The AWS CLI text result for the artifact bucket output.
 * @throws If the AWS CLI lookup fails.
 */
export function artifactBucket() {
  return run(
    "aws",
    [
      "cloudformation", "describe-stacks",
      "--profile", awsSettings.profile, "--region", awsSettings.region,
      "--stack-name", "agentic-setup-s3",
      "--query", "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue",
      "--output", "text",
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}

/**
 * Gives deployment steps a common process boundary: commands resolve relative
 * paths from the repository and failures interrupt the calling workflow.
 * Output is inherited for interactive diagnostics unless a caller overrides
 * stdio to capture a bucket name or object version. Arguments are passed
 * directly to the executable, so callers must supply tokens without shell quoting.
 *
 * @param {string} command Executable available to the deployment environment.
 * @param {string[]} argumentsList Argument tokens in executable order.
 * @param {import("node:child_process").ExecFileSyncOptions} options Process overrides.
 * @returns {} Captured stdout, or null when stdout is inherited.
 * @throws If the command cannot start or exits unsuccessfully.
 */
export function run(command, argumentsList, options = {}) {
  const started = performance.now();
  log("debug", "command.started", { command });
  try {
    const output = execFileSync(command, argumentsList, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: "inherit",
      ...options,
    });
    log("debug", "command.completed", { command, durationMs: performance.now() - started });
    return output;
  } catch (error) {
    log("error", "command.failed", {
      command, durationMs: performance.now() - started,
      exitCode: typeof error.status === "number" ? error.status : undefined,
      code: typeof error.code === "string" ? error.code : undefined,
    });
    throw error;
  }
}

/**
 * Runs a synchronous deployment stage with consistent lifecycle diagnostics.
 * Script entry points use this boundary to report local and subprocess failures
 * without printing raw exception messages that may contain secret arguments.
 * Individual commands retain their configured stdout and stderr behavior.
 * A failed stage sets the process exit code to one so parent workflows stop;
 * successful stages retain the existing exit code and return no result.
 *
 * @param {string} workflow Stable stage name attached to every nested log.
 * @param {() => void} operation Synchronous stage implementation.
 */
export function runWorkflow(workflow, operation) {
  withLogContext({ workflow }, () => {
    const started = performance.now();
    log("info", "workflow.started");
    try {
      operation();
      log("info", "workflow.completed", { durationMs: performance.now() - started });
    } catch {
      log("error", "workflow.failed", { durationMs: performance.now() - started });
      process.exitCode = 1;
    }
  });
}
