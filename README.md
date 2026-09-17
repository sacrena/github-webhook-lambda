# From a GitHub request to a temporary worker

Someone writes `/agent fix the failing test` in GitHub. This project receives the request, saves it, and asks AWS to start a temporary machine. A deadline gives that machine a limited lifetime, and a separate cleanup process removes expired resources.

That request-to-worker path exists in the current code. Installing development tools, running a coding agent, and publishing a pull request are still planned.

Start with [the request’s journey](docs/execution-flow/README.md) to understand today’s behavior. The [worker design](docs/architecture/agentic-coding/README.md) describes the planned coding workflow, and the [developer guide](docs/development.md) explains where to work and how to check changes.

## What starts a request?

The Lambda receives GitHub webhooks at `POST /github/webhooks`. It verifies GitHub’s signature before reading the event. Supported events are issues, pull requests, conversation comments, and inline PR review comments. Review submissions (`pull_request_review`) are not supported.

Text beginning with `@agent` or `/agent` starts processing. For a comment, the comment’s own text is used. The match is case-sensitive and allows no leading spaces; it currently also matches text such as `/agentAnything`. The code verifies the delivery’s origin but does not yet restrict which people or repositories may request work.

## Build and deploy

You need Node.js 22+, npm, zip, and AWS CLI credentials. Run these commands from the repository root, targeting `us-east-1`, where the worker image and networking are configured.

For the first deployment, set `GITHUB_WEBHOOK_SECRET` and `PROVISION_API_KEY`. On later deployments, omit them to reuse the saved stack parameters, or supply new values to update them.

```sh
npm ci
export AWS_PROFILE=sso-admin-profile
export AWS_REGION=us-east-1

# Create the artifact bucket once.
aws cloudformation deploy \
  --stack-name agentic-setup-s3 \
  --template-file cloudformation/agentic-setup-s3.yaml

npm run lambda:deploy

aws cloudformation describe-stacks --stack-name agentic-setup-lambda \
  --query 'Stacks[0].Outputs' --output table
```

The deployment command combines the source templates into one stack, uploads the Lambda package, and pins it to the uploaded S3 version. Deploy through this command: `cloudformation/agent-setup.yaml` is input to the builder, not a template to deploy directly.

After deployment, `GET /ping` returns `{"message":"pong"}`. This checks that the endpoint responds; it does not test AWS access or launch a worker.
