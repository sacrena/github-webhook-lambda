import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  assert.deepEqual(environment.EC2_SECURITY_GROUP_ID, { "Fn::GetAtt": ["WorkerSecurityGroup", "GroupId"] });
  assert.deepEqual(resources.PingFunction.Properties.Code.S3ObjectVersion, { Ref: "CodeVersion" });
  assert.deepEqual(resources.ProvisionDestination.Properties.InvocationEndpoint["Fn::Sub"][1].LambdaFunctionUrl,
    { "Fn::GetAtt": ["PingFunctionUrl", "FunctionUrl"] });
  assert.deepEqual(template.Outputs.GitHubWebhookUrl.Value, { "Fn::Sub": "${PingFunctionUrl.FunctionUrl}github/webhooks" });
});

test("worker security group is stack-owned in the selected default VPC and has no ingress rules", () => {
  const { Resources: resources, Parameters: parameters } = JSON.parse(readFileSync(buildTemplate(), "utf8"));
  const group = resources.WorkerSecurityGroup.Properties;
  assert.equal(group.VpcId, "vpc-0773cc6f63148e689");
  assert.equal(parameters.WorkerVpcId, undefined);
  assert.equal(group.SecurityGroupIngress, undefined);
  assert.deepEqual(group.SecurityGroupEgress, [{
    IpProtocol: "-1", CidrIp: "0.0.0.0/0", Description: "Permit worker access to required external services.",
  }]);
});

test("composition rejects duplicate resource identities instead of overwriting an existing resource", () => {
  const root = { Resources: { First: { Properties: {} }, Second: { Properties: {} } }, Outputs: {} };
  const component = { Resources: { Shared: { Type: "AWS::SecretsManager::Secret" } } };
  assert.throws(() => composeTemplate(root, { First: component, Second: component }), /Duplicate resource logical ID/);
});

test("deployment validation names existing component templates including worker permissions", () => {
  const script = readFileSync("scripts/LambdaValidation.mjs", "utf8");
  const names = [...script.matchAll(/"(agentic-[a-z-]+)"/g)].map((match) => match[1]);
  assert.ok(names.includes("agentic-policy-setup"));
  for (const name of names) assert.ok(existsSync(`cloudformation/${name}.yaml`), `${name} template is missing`);
});

test("every runtime environment read is injected by the template or supplied by Lambda", () => {
  const { Resources: resources } = JSON.parse(readFileSync(buildTemplate(), "utf8"));
  const environment = resources.PingFunction.Properties.Environment.Variables;
  const suppliedByLambda = new Set(["AWS_REGION", "AWS_LAMBDA_FUNCTION_NAME"]);
  const names = new Set();
  for (const file of readdirSync("src", { recursive: true }).filter((name) => /\.(ts|js)$/.test(name))) {
    const source = readFileSync(`src/${file}`, "utf8");
    for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1]);
  }
  for (const name of names) assert.ok(suppliedByLambda.has(name) || Object.hasOwn(environment, name), `${name} is not injected`);
  assert.equal(environment.LOG_LEVEL, "info");
  assert.deepEqual(environment.GITHUB_WEBHOOK_SECRET["Fn::Sub"][1].GitHubWebhookSecretArn, { Ref: "GitHubWebhookSecret" });
  assert.deepEqual(resources.ProvisionRule.Properties.EventPattern, {
    source: ["agentic.setup"], "detail-type": ["ProvisionRequested"],
  });
});

test("worker EC2 policy is composed once and attached to the Lambda role", () => {
  const { Resources: resources } = JSON.parse(readFileSync(buildTemplate(), "utf8"));
  const role = resources.PingFunctionRole.Properties;
  assert.ok(role.ManagedPolicyArns.some((arn) => arn.Ref === "WorkerEC2Policy"));
  assert.ok(role.Policies.every((policy) => policy.PolicyName !== "manage-worker-instances"));
  assert.equal(resources.WorkerEC2Policy.Type, "AWS::IAM::ManagedPolicy");

  const statements = resources.WorkerEC2Policy.Properties.PolicyDocument.Statement;
  assert.equal(statements.length, 5);
  assert.deepEqual(statements[0].Action, ["ec2:DescribeImages", "ec2:DescribeInstances"]);
  for (const action of ["ec2:DeleteVolume", "ec2:DeleteNetworkInterface"]) {
    assert.ok(!statements.some((statement) => statement.Action === action));
  }
  const terminate = statements.find((statement) => statement.Action === "ec2:TerminateInstances");
  assert.equal(terminate.Condition.StringEquals["ec2:ResourceTag/ManagedBy"], "agentic-setup");
  assert.ok(terminate.Resource["Fn::Sub"].endsWith(":instance/*"));
  const tagging = statements.find((statement) => statement.Action === "ec2:CreateTags");
  assert.equal(tagging.Condition.StringEquals["ec2:CreateAction"], "RunInstances");
  assert.equal(tagging.Condition.StringEquals["aws:RequestTag/ManagedBy"], "agentic-setup");
  assert.ok(role.Policies.some((policy) => policy.PolicyName === "track-requests"));
});

test("timeout infrastructure shares authentication and scopes schedule execution to its bus", () => {
  const { Resources: resources, Outputs: outputs } = JSON.parse(readFileSync(buildTemplate(), "utf8"));
  const environment = resources.PingFunction.Properties.Environment.Variables;
  const timeout = resources.TimeoutDestination.Properties;
  assert.deepEqual(resources.TimeoutConnection.Properties.AuthParameters,
    resources.ProvisionConnection.Properties.AuthParameters);
  assert.deepEqual(timeout.ConnectionArn, { "Fn::GetAtt": ["TimeoutConnection", "Arn"] });
  assert.equal(timeout.InvocationEndpoint["Fn::Sub"][0], "${LambdaFunctionUrl}timeout");
  assert.equal(resources.TimeoutEventBus.Properties.Name, "agentic-timeout-events");
  assert.deepEqual(resources.TimeoutRule.Properties.EventBusName, { Ref: "TimeoutEventBus" });
  assert.deepEqual(resources.TimeoutRule.Properties.EventPattern,
    { source: ["agentic.setup"], "detail-type": ["TimeoutRequested"] });
  assert.equal(environment.TIMEOUT_SCHEDULE_GROUP, resources.TimeoutScheduleGroup.Properties.Name);
  assert.ok(environment.TIMEOUT_EVENT_BUS_ARN["Fn::Sub"].endsWith(`event-bus/${resources.TimeoutEventBus.Properties.Name}`));
  assert.ok(environment.TIMEOUT_SCHEDULER_ROLE_ARN["Fn::Sub"].endsWith(`role/${resources.TimeoutSchedulerRole.Properties.RoleName}`));
  const role = resources.TimeoutSchedulerRole.Properties;
  assert.deepEqual(role.Policies[0].PolicyDocument.Statement,
    [{ Effect: "Allow", Action: "events:PutEvents", Resource: { "Fn::GetAtt": ["TimeoutEventBus", "Arn"] } }]);
  assert.deepEqual(role.AssumeRolePolicyDocument.Statement[0].Condition.ArnEquals["aws:SourceArn"],
    { "Fn::GetAtt": ["TimeoutScheduleGroup", "Arn"] });
  const permissions = resources.PingFunctionRole.Properties.Policies.find((policy) => policy.PolicyName === "schedule-timeouts");
  assert.deepEqual(permissions.PolicyDocument.Statement[0].Action, ["scheduler:CreateSchedule", "scheduler:GetSchedule"]);
  assert.ok(permissions.PolicyDocument.Statement[0].Resource["Fn::Sub"].endsWith("schedule/agentic-timeouts/timeout-*"));
  assert.equal(permissions.PolicyDocument.Statement[1].Condition.StringEquals["iam:PassedToService"], "scheduler.amazonaws.com");
  assert.deepEqual(outputs.TimeoutEventBusName.Value, { Ref: "TimeoutEventBus" });
});

test("recurring cleanup reaches its authenticated destination through a dedicated bus", () => {
  const { Resources: resources, Parameters: parameters, Outputs: outputs } = JSON.parse(readFileSync(buildTemplate(), "utf8"));
  const schedule = resources.CleanupSchedule.Properties;
  const rule = resources.CleanupRule.Properties;
  const destination = resources.CleanupDestination.Properties;
  assert.equal(parameters.CleanupScheduleExpression.Default, "rate(1 minute)");
  assert.deepEqual(schedule.ScheduleExpression, { Ref: "CleanupScheduleExpression" });
  assert.equal(schedule.State, "ENABLED");
  assert.equal(schedule.FlexibleTimeWindow.Mode, "OFF");
  assert.equal(resources.CleanupSchedule.DependsOn, "CleanupRule");
  assert.deepEqual(schedule.GroupName, { Ref: "CleanupScheduleGroup" });
  assert.deepEqual(schedule.Target.Arn, { "Fn::GetAtt": ["CleanupEventBus", "Arn"] });
  assert.deepEqual(schedule.Target.RoleArn, { "Fn::GetAtt": ["CleanupSchedulerRole", "Arn"] });
  assert.deepEqual(JSON.parse(schedule.Target.Input), {});
  assert.deepEqual(rule.EventBusName, { Ref: "CleanupEventBus" });
  assert.deepEqual(rule.EventPattern, {
    source: [schedule.Target.EventBridgeParameters.Source],
    "detail-type": [schedule.Target.EventBridgeParameters.DetailType],
  });
  assert.equal(rule.State, "ENABLED");
  assert.deepEqual(rule.Targets[0].Arn, { "Fn::GetAtt": ["CleanupDestination", "Arn"] });
  assert.deepEqual(rule.Targets[0].RoleArn, { "Fn::GetAtt": ["DestinationRole", "Arn"] });
  assert.deepEqual(destination.ConnectionArn, { "Fn::GetAtt": ["CleanupConnection", "Arn"] });
  assert.equal(destination.HttpMethod, "POST");
  assert.equal(destination.InvocationEndpoint["Fn::Sub"][0], "${LambdaFunctionUrl}cleanup");
  assert.deepEqual(destination.InvocationEndpoint["Fn::Sub"][1].LambdaFunctionUrl,
    { "Fn::GetAtt": ["PingFunctionUrl", "FunctionUrl"] });
  assert.deepEqual(resources.CleanupConnection.Properties.AuthParameters,
    resources.ProvisionConnection.Properties.AuthParameters);

  const role = resources.CleanupSchedulerRole.Properties;
  assert.deepEqual(role.Policies[0].PolicyDocument.Statement,
    [{ Effect: "Allow", Action: "events:PutEvents", Resource: { "Fn::GetAtt": ["CleanupEventBus", "Arn"] } }]);
  assert.deepEqual(role.AssumeRolePolicyDocument.Statement[0].Condition.ArnEquals["aws:SourceArn"],
    { "Fn::GetAtt": ["CleanupScheduleGroup", "Arn"] });
  const invocationPermissions = resources.DestinationRole.Properties.Policies[0].PolicyDocument.Statement;
  assert.ok(invocationPermissions.some((statement) => statement.Action === "events:InvokeApiDestination"
    && statement.Resource["Fn::GetAtt"][0] === "CleanupDestination"));
  assert.deepEqual(outputs.CleanupEventBusName.Value, { Ref: "CleanupEventBus" });
  assert.deepEqual(outputs.CleanupUrl.Value, destination.InvocationEndpoint);
});
