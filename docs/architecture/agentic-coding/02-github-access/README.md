# 2. Giving the worker access to GitHub

[Overview](../README.md) · [Previous: intake](../01-job-intake/README.md) · [Next: machine setup](../03-ec2-setup/README.md)

The worker has an assignment, but it still needs permission to fetch code and publish a result. The proposed GitHub App supplies that identity. This access flow is not implemented yet.

The webhook and the App have different jobs: the webhook delivers the request; the App authorizes repository operations. There is no GitHub App executable to install on EC2.

## Set up the identity once

Create an organization-owned GitHub App and install it on the selected repositories. Keep its private key in Secrets Manager, with the App ID and installation mapping in the control service’s configuration.

| Permission | What it enables |
| --- | --- |
| Contents: read and write | Fetch code and push the result branch |
| Pull requests: read and write | Read PR context and create a PR |
| Issues: read | Read issue text and comments |
| Metadata: read | GitHub’s required baseline access |

Add comment-writing permissions only if progress comments are part of the product. Workflow-file changes need separate consideration.

A write token is not limited to an agent branch by itself. Repository rules should protect default and release branches, and the publishing script should enforce the assigned output branch.

## Hand out access when the worker is ready

After setup, the worker asks the control service to claim its job. The service must verify that this worker owns that active assignment and that its deadline has not passed.

Only then does the service use the App key to request a temporary installation token for the assigned repository. The private key stays in the control service. Installation tokens normally expire after one hour; renewal should repeat the assignment and deadline checks.

Worker identity needs an implementation decision. Knowing a job ID or supplying an instance ID is not proof of ownership, especially when workers share an AWS role.

## Use the token without leaving it behind

Git uses a temporary credential helper, keeping the remote URL clean: `https://github.com/org/repository.git`. Tokens should not appear in clone URLs, command arguments, startup scripts, or logs. GitHub CLI is optional; the Kotlin runner can also call GitHub’s API directly.

Pass publishing credentials only to commands that need them. Repository code and Docker access affect how strongly processes can be separated on the worker, so that boundary needs testing.

If access is revoked or renewal fails, save the reason and end the attempt. Revoke temporary access when possible at completion. The coding agent’s provider credential is a separate credential with its own delivery path.

See GitHub’s [installation-token guide](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token) and [Git authentication guidance](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).
