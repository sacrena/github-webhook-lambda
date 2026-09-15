# GitHub webhook Lambda

Small TypeScript Lambda with no runtime dependencies. Plain CloudFormation creates a Function URL and execution role. No API Gateway or SAM required. See the [developer guide](docs/development.md) for module responsibilities and method behavior.

`GET /ping` returns a JSON pong response. `POST /github/webhooks` extracts normalized data for these GitHub events, preserving the supplied action:

| GitHub event | Meaning |
| --- | --- |
| `pull_request` | PR activity |
| `issues` | Issue activity |
| `issue_comment` | Issue or PR conversation comment |
| `pull_request_review_comment` | Inline PR review comment |

GitHub deliveries must include a valid `X-Hub-Signature-256` HMAC-SHA256 signature calculated with the configured webhook secret. The webhook response contains extracted data; there is no job processing, storage, or deduplication. PR review submissions (`pull_request_review`) are not comment events handled by this version.

## Build and deploy

Requires Node.js 22+, npm, zip, and AWS CLI credentials. Run from the repository root. Lambda code lives in `src/`; `cloudformation/` contains the S3 artifact-bucket and Lambda templates.

```sh
npm ci
npm run package

# Create the managed artifact bucket once.
aws cloudformation deploy \
  --stack-name agentic-setup-s3 \
  --template-file cloudformation/agentic-setup-s3.yaml

ARTIFACT_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name agentic-setup-s3 \
  --query "Stacks[0].Outputs[?OutputKey=='ArtifactBucketName'].OutputValue" \
  --output text)
VERSION=$(node -p "require('./package.json').version")
CODE_KEY="v$VERSION/lambda.zip"

aws s3api put-object \
  --bucket "$ARTIFACT_BUCKET" \
  --key "$CODE_KEY" \
  --body "output/v$VERSION/lambda.zip"
GITHUB_WEBHOOK_SECRET='choose-a-secret-on-first-deployment'
aws cloudformation deploy \
  --stack-name agentic-setup-lambda \
  --template-file cloudformation/agentic-setup-lambda.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    CodeKey="$CODE_KEY" \
    GitHubWebhookSecretValue="$GITHUB_WEBHOOK_SECRET"

aws cloudformation describe-stacks --stack-name agentic-setup-lambda \
  --query 'Stacks[0].Outputs' --output table
```
