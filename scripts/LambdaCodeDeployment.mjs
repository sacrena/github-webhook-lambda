import {
  artifactBucket,
  artifactLocations,
  artifactVersion,
  awsSettings,
  run, runWorkflow, log,
} from "./DeploymentUtilities.mjs";

/**
 * Provides the artifact-upload stage used by `lambda:deploy` and by callers
 * publishing code through `code:deploy`. Packaging must succeed before upload,
 * and the destination bucket comes from the artifact stack. The upload prints
 * its S3 object version for inspection; stack deployment uses the package key.
 * Uploading a replacement at the same key alone does not update Lambda code.
 */
function deployCode() {
  run("npm", ["run", "--silent", "package"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const version = artifactVersion();
  const artifact = artifactLocations(version);
  const bucket = artifactBucket();
  log("info", "artifact.upload.started", { version, bucket, key: artifact.key });
  run("aws", [
    "s3api", "put-object",
    "--profile", awsSettings.profile, "--region", awsSettings.region,
    "--bucket", bucket, "--key", artifact.key,
    "--body", artifact.archivePath, "--query", "VersionId", "--output", "text",
  ]);
  log("info", "artifact.upload.completed", { version, bucket, key: artifact.key });
}

runWorkflow("code.deploy", deployCode);
