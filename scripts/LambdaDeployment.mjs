import {
  artifactLocations,
  artifactBucket,
  artifactVersion,
  awsSettings,
  run, runWorkflow, log,
} from "./DeploymentUtilities.mjs";
import { buildTemplate } from "./CloudFormationTemplate.mjs";

/**
 * Coordinates the `lambda:deploy` workflow so CloudFormation receives the
 * package key uploaded by `code:deploy`. Pinning the uploaded S3 object version
 * makes updates deploy new code even when the package key stays the same.
 * Local tests and template validation must succeed before upload.
 * Component templates are combined into one stack
 * that preserves the existing agentic-setup-lambda resource logical IDs.
 * Set GITHUB_WEBHOOK_SECRET and PROVISION_API_KEY when creating the stack;
 * omit either on updates to preserve its existing stack parameter value.
 */
function deployLambda() {
  run("npm", ["run", "validate"]);

  const version = artifactVersion();
  const artifact = artifactLocations(version);
  const bucket = artifactBucket();

  const parameters = ["--parameter-overrides", `CodeKey=${artifact.key}`, `CodeBucket=${bucket}`];
  if (process.env.GITHUB_WEBHOOK_SECRET)
    parameters.push(`GitHubWebhookSecretValue=${process.env.GITHUB_WEBHOOK_SECRET}`);
  if (process.env.PROVISION_API_KEY)
    parameters.push(`ProvisionApiKeyValue=${process.env.PROVISION_API_KEY}`);

  run("npm", ["run", "code:deploy"]);

  const codeVersion = run("aws", [
    "s3api", "head-object",
    "--profile", awsSettings.profile, "--region", awsSettings.region,
    "--bucket", bucket, "--key", artifact.key,
    "--query", "VersionId", "--output", "text",
  ], { stdio: ["ignore", "pipe", "inherit"] }).trim();
  if (!codeVersion || codeVersion === "None" || codeVersion === "null")
    throw new Error("Lambda deployment requires a versioned artifact");

  parameters.push(`CodeVersion=${codeVersion}`);

  const packagedTemplate = buildTemplate();

  log("info", "lambda.deploy.started", { version, key: artifact.key });
  run("aws", [
    "cloudformation", "deploy",
    "--profile", awsSettings.profile, "--region", awsSettings.region,
    "--stack-name", "agentic-setup-lambda",
    "--template-file", packagedTemplate,
    "--capabilities", "CAPABILITY_NAMED_IAM", ...parameters,
  ]);
  log("info", "lambda.deploy.completed", { version, key: artifact.key });
}

runWorkflow("lambda.deploy", deployLambda);
