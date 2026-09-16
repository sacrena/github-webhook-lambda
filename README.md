# GitHub webhook Lambda

Small TypeScript Lambda with AWS SDK dependencies for request storage. Plain CloudFormation creates a Function URL and execution role. No API Gateway or SAM required. See the [developer guide](docs/development.md) for module responsibilities and method behavior.

`GET /ping` returns a JSON pong response. `POST /github/webhooks` extracts normalized data for these GitHub events, preserving the supplied action:

| GitHub event | Meaning |
| --- | --- |
| `pull_request` | PR activity |
| `issues` | Issue activity |
| `issue_comment` | Issue or PR conversation comment |
| `pull_request_review_comment` | Inline PR review comment |

GitHub deliveries must include a valid `X-Hub-Signature-256` HMAC-SHA256 signature calculated with the configured webhook secret. The webhook response contains extracted data; there is no job processing, storage, or deduplication. PR review submissions (`pull_request_review`) are not comment events handled by this version.

## Build and deploy

Requires Node.js 22+, npm, zip, and AWS CLI credentials. Run from the repository root. `cloudformation/agent-setup.yaml` defines the wiring between the Secrets Manager, Lambda, EventBridge, and DynamoDB source templates. The deployment builder combines them into one template for the existing `agentic-setup-lambda` stack, preserving resource logical IDs and creating no nested stacks. The artifact bucket is bootstrapped separately.

Set `GITHUB_WEBHOOK_SECRET` and `PROVISION_API_KEY` for initial creation, or set either to change that secret's parameter. Omit them on subsequent updates to reuse stored stack parameters. Lambda code is pinned to the uploaded S3 object version, so deploying at the same package version still updates the code.

```sh
npm ci
export AWS_PROFILE=sso-admin-profile

# Create the managed artifact bucket once.
aws cloudformation deploy \
  --stack-name agentic-setup-s3 \
  --template-file cloudformation/agentic-setup-s3.yaml

npm run lambda:deploy

aws cloudformation describe-stacks --stack-name agentic-setup-lambda \
  --query 'Stacks[0].Outputs' --output table
```
