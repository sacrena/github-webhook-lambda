import { awsSettings, run, runWorkflow } from "./DeploymentUtilities.mjs";
import { buildTemplate } from "./CloudFormationTemplate.mjs";

/**
 * Supplies the validation stage used by `lambda:deploy` before it uploads
 * an artifact. Local tests precede all CloudFormation template checks so a
 * failing build or test stops the workflow before AWS is contacted. The
 * template check requires credentials for the configured profile and region;
 * its success does not establish that the later stack deployment will succeed.
 */
function validate() {
  run("npm", ["test"]);

  const templates = [
    "agentic-setup-lambda", "agentic-secrets-setup",
    "agentic-event-setup", "agentic-dynamodb-setup",
  ];
  const filenames = [buildTemplate(), ...templates.map((name) => `cloudformation/${name}.yaml`)];

  for (const filename of filenames) {
    run("aws", [
      "cloudformation", "validate-template",
      "--profile", awsSettings.profile, "--region", awsSettings.region,
      "--template-body", `file://${filename}`,
    ]);
  }
}

runWorkflow("validate", validate);
