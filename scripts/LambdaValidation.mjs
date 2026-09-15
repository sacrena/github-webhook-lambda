import { awsSettings, run, runWorkflow } from "./DeploymentUtilities.mjs";

/**
 * Supplies the validation stage used by `lambda:deploy` before it uploads
 * an artifact. Local tests precede the CloudFormation template check so a
 * failing build or test stops the workflow before AWS is contacted. The
 * template check requires credentials for the configured profile and region;
 * its success does not establish that the later stack deployment will succeed.
 */
function validate() {
  run("npm", ["test"]);
  run("aws", [
    "cloudformation", "validate-template",
    "--profile", awsSettings.profile, "--region", awsSettings.region,
    "--template-body", "file://cloudformation/agentic-setup-lambda.yaml",
  ]);
}

runWorkflow("validate", validate);
