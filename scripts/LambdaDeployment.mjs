import {
  artifactLocations,
  artifactVersion,
  awsSettings,
  run, runWorkflow, log,
} from "./DeploymentUtilities.mjs";

/**
 * Coordinates the `lambda:deploy` workflow so CloudFormation receives the
 * package key uploaded by `code:deploy`. Lambda retrieves the current S3 object
 * for that key, while a package-version change produces a new key that causes
 * CloudFormation to update the function. Local tests and template validation
 * must succeed before upload, and the artifact stack owns the default bucket.
 * Set GITHUB_WEBHOOK_SECRET when creating the stack or replacing its secret;
 * omit it on updates to preserve the existing stack parameter value.
 */
function deployLambda() {
  run("npm", ["run", "validate"]);
  const version = artifactVersion();
  const artifact = artifactLocations(version);
  const parameters = ["--parameter-overrides", `CodeKey=${artifact.key}`];
  if (process.env.GITHUB_WEBHOOK_SECRET)
    parameters.push(
      `GitHubWebhookSecretValue=${process.env.GITHUB_WEBHOOK_SECRET}`,
    );

  run("npm", ["run", "code:deploy"]);
  log("info", "lambda.deploy.started", { version, key: artifact.key });
  run("aws", [
    "cloudformation", "deploy",
    "--profile", awsSettings.profile, "--region", awsSettings.region,
    "--stack-name", "agentic-setup-lambda",
    "--template-file", "cloudformation/agentic-setup-lambda.yaml",
    "--capabilities", "CAPABILITY_NAMED_IAM", ...parameters,
  ]);
  log("info", "lambda.deploy.completed", { version, key: artifact.key });
}

runWorkflow("lambda.deploy", deployLambda);
