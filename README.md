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

aws s3 cp "output/v$VERSION/lambda.zip" "s3://$ARTIFACT_BUCKET/$CODE_KEY"
aws cloudformation deploy \
  --stack-name agentic-setup-lambda \
  --template-file cloudformation/agentic-setup-lambda.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    CodeBucket="$ARTIFACT_BUCKET" \
    CodeKey="$CODE_KEY"

aws cloudformation describe-stacks --stack-name agentic-setup-lambda \
  --query 'Stacks[0].Outputs' --output table
```
