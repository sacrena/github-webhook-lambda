import {
  artifactBucket, artifactLocations, artifactVersion, awsSettings, run,
} from "./DeploymentUtilities.mjs";

/**
 * Provides the artifact-upload stage used by `lambda:deploy` and by callers
 * publishing code through `code:deploy`. The parent treats stdout as the S3
 * object version to pass to CloudFormation, so packaging output must stay off
 * that stream. Build diagnostics remain on stderr, and a failed build stops
 * the workflow before upload. The destination comes from the artifact stack.
 */
function deployCode() {
  run("npm", ["run", "--silent", "package"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const version = artifactVersion();
  const artifact = artifactLocations(version);
  const bucket = artifactBucket();
  run("aws", [
    "s3api", "put-object",
    "--profile", awsSettings.profile, "--region", awsSettings.region,
    "--bucket", bucket, "--key", artifact.key,
    "--body", artifact.archivePath,
    "--query", "VersionId", "--output", "text",
  ]);
}

deployCode();
