import {
  artifactBucket, artifactLocations, artifactVersion, awsSettings, run,
} from "./DeploymentUtilities.mjs";

/**
 * Coordinates the `lambda:deploy` workflow so CloudFormation receives the
 * specific S3 revision returned by `code:deploy`. A versioned object reference
 * distinguishes successive uploads even when their package version is unchanged.
 * Local tests and template validation must succeed before the upload stage;
 * the captured upload output is then passed as the stack's CodeVersion input.
 */
function deployLambda() {
  run("npm", ["run", "validate"]);
  const version = artifactVersion();
  const artifact = artifactLocations(version);
  const bucket = artifactBucket();
  const objectVersion = run("npm", ["run", "--silent", "code:deploy"], {
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  run("aws", [
    "cloudformation", "deploy",
    "--profile", awsSettings.profile, "--region", awsSettings.region,
    "--stack-name", "agentic-setup-lambda",
    "--template-file", "cloudformation/agentic-setup-lambda.yaml",
    "--capabilities", "CAPABILITY_NAMED_IAM",
    "--parameter-overrides", `CodeBucket=${bucket}`,
    `CodeKey=${artifact.key}`, `CodeVersion=${objectVersion}`,
  ]);
}

deployLambda();
