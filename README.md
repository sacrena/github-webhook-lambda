# GitHub webhook Lambda

Small TypeScript Lambda with no runtime dependencies. Plain CloudFormation creates a Function URL, execution role, and CloudWatch log group (7-day retention). No API Gateway or SAM required.

The handler verifies GitHub's SHA-256 signature against the original body, then logs the event type, delivery ID, and complete payload for:

| GitHub event | Action | Meaning |
| --- | --- | --- |
| `pull_request` | `opened` | PR created |
| `issues` | `opened` | Issue created |
| `issue_comment` | `created` | Issue or PR conversation comment |
| `pull_request_review_comment` | `created` | Inline PR review comment |

Signed `ping` requests receive `pong`. Other events/actions are acknowledged and ignored. There is no job processing, storage, or deduplication; repeat deliveries are logged again. PR review submissions (`pull_request_review`) are not comment events handled by this version.

## Build and deploy

Requires Node.js 22+, npm, zip, AWS CLI credentials, and an existing S3 artifact bucket in the deployment region. Run from the repository root. Lambda code lives in `src/`; `cloudformation/` contains only infrastructure templates.

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
CODE_KEY="github-webhook/$(date +%Y%m%d%H%M%S).zip"
read -rs 'WEBHOOK_SECRET?GitHub webhook secret (at least 32 characters): '

aws s3 cp lambda.zip "s3://$ARTIFACT_BUCKET/$CODE_KEY"
aws cloudformation deploy \
  --stack-name agentic-setup-lambda \
  --template-file cloudformation/agentic-setup-lambda.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    CodeBucket="$ARTIFACT_BUCKET" \
    CodeKey="$CODE_KEY" \
    WebhookSecret="$WEBHOOK_SECRET"
unset WEBHOOK_SECRET

aws cloudformation describe-stacks --stack-name github-webhook \
  --query 'Stacks[0].Outputs' --output table
```

The secret input command above uses zsh. In bash, use `read -rs -p 'GitHub webhook secret: ' WEBHOOK_SECRET`.

In GitHub repository **Settings → Webhooks → Add webhook**, set the output URL as the payload URL, content type to `application/json`, and the same secret. Select individual events: **Pull requests**, **Issues**, **Issue comments**, and **Pull request review comments**. Leave SSL verification enabled.

Inspect incoming event data using the `LogGroup` output:

```sh
aws logs tail '<LogGroup output>' --follow
```

The URL is public so GitHub can call it; signature verification happens in the Lambda. Payloads include issue/PR text and user information, so log access should be limited accordingly.
