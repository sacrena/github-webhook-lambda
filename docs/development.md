# Working on the project

Start with [the request’s journey](execution-flow/README.md) if you are new to the system. This guide helps you find the code behind that journey and check a change before deploying it.

The [provisioning release contract](provisioning-release.md) records endpoint responses, cleanup limits, retry behavior and the complete Lambda environment injection audit.

The application is a TypeScript Lambda running on Node.js 22. It receives GitHub requests, stores them, and manages temporary EC2 workers. The coding tools and runner that will eventually work inside those machines are still planned.

## Find the part you need

| If you are changing… | Start here |
| --- | --- |
| Which URL handles a request | [src/index.ts](../src/index.ts) |
| GitHub signatures, payloads, or command selection | [src/github](../src/github) |
| The saved request or its deadline | [src/requests](../src/requests) |
| AWS database, scheduling, event, or EC2 calls | [src/aws](../src/aws) |
| Worker launch, identity tracking, or cleanup | [src/provision](../src/provision) |
| Timeout handling | [src/timeout](../src/timeout) |
| Shared responses, authentication, or logs | [src/shared](../src/shared) |
| AWS resources and permissions | [cloudformation](../cloudformation) |
| Packaging and deployment | [scripts](../scripts) |

Keep routing focused on choosing an endpoint. Endpoint code decides what a request means; AWS services perform the cloud operations. The launch journal saves worker identity, configuration helpers choose fixed settings, and resource helpers interpret AWS observations.

Before changing code, read the repository’s [structure](../.agents/skills/code-structure/SKILL.md), [documentation](../.agents/skills/code-documentation/SKILL.md), and [quality](../.agents/skills/code-quality/SKILL.md) skills. Search for an existing helper before adding another, and explain caller expectations in connected prose.

## Understand the five routes

| Route | Its role |
| --- | --- |
| `GET /ping` | Return a small response to check reachability |
| `POST /github/webhooks` | Verify GitHub’s signature, select commands, save and dispatch requests |
| `POST /provision` | Authenticate an event, read the saved request, and allocate its worker |
| `POST /timeout` | Authenticate an event and terminate its worker after the saved deadline |
| `POST /cleanup` | Remove expired managed instances and detached resources |

The last three routes require the shared API key. Provisioning and timeout also validate the event envelope and use its delivery ID to read authoritative input from the database.

## Preserve the lifetime of a request

Three details make retries predictable. The saved receipt time fixes the deadline. A stable schedule name lets repeated deliveries reuse the timeout. A stable EC2 launch token lets a repeated launch refer to the same machine.

The database saves the original request plus the launch identity, not a complete lifecycle history. An EC2 response can include status and timestamps that are never written to DynamoDB. See [what the system remembers](execution-flow/05-data-ledger.md) before adding behavior that depends on saved state.

Worker region, image, and instance size are fixed in [ProvisioningConstants](../src/provision/ProvisioningConstants.ts). The service accepts a delivery ID and absolute deadline, with an optional table argument. There is no per-request instance-size override.

## Check your change

```sh
npm ci
npm test
npm run package
```

`npm test` compiles TypeScript and runs the local tests, including mocked AWS interactions. `npm run package` creates the Lambda archive. If you add a runtime module, check that the packaged imports still resolve.

`npm run validate` also runs local tests, builds the combined infrastructure template, and asks AWS to validate templates. It needs AWS credentials. Template validation does not create resources or prove that an EC2 worker can boot.

For documentation changes, check relative links and examples against the current source. Distinguish implemented behavior from the [planned worker workflow](architecture/agentic-coding/README.md).

## How deployment fits together

[agent-setup.yaml](../cloudformation/agent-setup.yaml) connects six source components: policy, secrets, database, security group, Lambda, and events. [CloudFormationTemplate](../scripts/CloudFormationTemplate.mjs) combines them into one deployable stack and rejects duplicate resource IDs.

Use `npm run lambda:deploy` after the separate artifact bucket has been created. It uploads the package and supplies the S3 object version to the stack, so another upload at the same package version can still update Lambda. The [root README](../README.md) has the setup commands.

The worker region is `us-east-1`, and its security-group template names an account-specific default VPC. Confirm that networking exists in the target account. Event resources also use fixed names; changing one requires updating its consumers.

The database and shared secrets are retained on stack deletion or replacement. Their retention preserves data but can leave resources and charges after stack removal. Secret changes also need the Lambda and EventBridge configurations refreshed; changing the stored secret alone is insufficient.

## Follow a request in the logs

Each log record has a timestamp, level, and event name. HTTP logs add a request ID, method, path, response status, and elapsed time. The GitHub delivery ID connects separate calls belonging to the same request.

Set `LOG_LEVEL` to `debug`, `info`, `warn`, `error`, or `silent`; the default is `info`. Lambda logs go through the matching console method, while local tooling logs use stderr so stdout remains available for command results.

The [logger](../src/shared/Logger.js) does not automatically redact fields. Callers choose what to include, so keep credentials and raw sensitive input out of added log calls.
