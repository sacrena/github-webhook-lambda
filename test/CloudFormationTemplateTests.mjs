import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildTemplate, composeTemplate } from "../scripts/CloudFormationTemplate.mjs";

test("deployment retains existing resources and resolves component wiring without nested stacks", () => {
  const template = JSON.parse(readFileSync(buildTemplate(), "utf8"));
  const resources = template.Resources;
  assert.ok(Object.values(resources).every((resource) => resource.Type !== "AWS::CloudFormation::Stack"));
  assert.equal(resources.PingFunction.Properties.FunctionName, "agentic-setup-lambda");
  assert.equal(resources.GitHubWebhookSecret.Properties.Name, "agentic-setup-github-webhook-secret");
  assert.deepEqual(resources.GitHubWebhookSecret.Properties.SecretString, { Ref: "GitHubWebhookSecretValue" });
  assert.deepEqual(resources.ProvisionApiKey.Properties.SecretString, { Ref: "ProvisionApiKeyValue" });

  const environment = resources.PingFunction.Properties.Environment.Variables;
  const connectionKey = resources.ProvisionConnection.Properties.AuthParameters.ApiKeyAuthParameters.ApiKeyValue;
  assert.deepEqual(environment.PROVISION_API_KEY["Fn::Sub"][1].ProvisionApiKeyArn, { Ref: "ProvisionApiKey" });
  assert.deepEqual(connectionKey["Fn::Sub"][1].ApiKeySecretArn, { Ref: "ProvisionApiKey" });
  assert.deepEqual(environment.REQUESTS_TABLE_NAME, { Ref: "RequestsTable" });
  assert.deepEqual(resources.PingFunction.Properties.Code.S3ObjectVersion, { Ref: "CodeVersion" });
  assert.deepEqual(resources.ProvisionDestination.Properties.InvocationEndpoint["Fn::Sub"][1].LambdaFunctionUrl,
    { "Fn::GetAtt": ["PingFunctionUrl", "FunctionUrl"] });
  assert.deepEqual(template.Outputs.GitHubWebhookUrl.Value, { "Fn::Sub": "${PingFunctionUrl.FunctionUrl}github/webhooks" });
});

test("composition rejects duplicate resource identities instead of overwriting an existing resource", () => {
  const root = { Resources: { First: { Properties: {} }, Second: { Properties: {} } }, Outputs: {} };
  const component = { Resources: { Shared: { Type: "AWS::SecretsManager::Secret" } } };
  assert.throws(() => composeTemplate(root, { First: component, Second: component }), /Duplicate resource logical ID/);
});
