# 1. Receiving the request

[Index](README.md) · [Next: saving and dispatch](02-dispatch.md)

Our example begins with a comment: `/agent fix the failing test`. GitHub sends the comment, repository details, and a delivery ID to `POST /github/webhooks`.

Before using the comment, the application checks GitHub’s signature against the original request bytes. This matters because parsing and rebuilding JSON could change the bytes being checked. A missing or invalid signature receives HTTP 401; a missing server secret receives 500.

## Making sense of the event

After verification, the application reads the JSON and checks the fields it needs. Invalid JSON or an invalid supported payload receives 400. An unsupported event with valid JSON is acknowledged with 202 and ignored.

GitHub uses slightly different shapes for related events:

| GitHub event | What the application reads |
| --- | --- |
| `issues` | The issue description |
| `pull_request` | The PR description |
| `issue_comment` | The comment on an issue or PR conversation |
| `pull_request_review_comment` | The inline review comment and its PR context |

A PR conversation comment arrives under `issue_comment`. GitHub’s `issue.pull_request` marker tells the application that its parent is a PR. That event does not contain the full branch and merge details available in a direct PR event. The application preserves what GitHub supplied; it makes no extra GitHub API call to fill gaps.

The mapping also gives fields consistent names: `full_name` becomes `fullName`, for example, and label objects become label names. The original action is preserved.

## Deciding whether work was requested

For comments, the application checks the comment itself. For issues and PRs, it checks the description. Text must begin with `@agent` or `/agent`, with the same case and no leading whitespace. There is currently no required separator, so `/agentAnything` also matches.

An ordinary comment gets a 202 response containing the mapped webhook, without creating a stored request. A command also needs `X-GitHub-Delivery`; without it, the response is 400. With it, the request moves to [storage and dispatch](02-dispatch.md).

Signature verification proves that the delivery matches the shared GitHub secret. The current handler does not check whether the commenter is an approved operator, filter event actions, or restrict repositories. Those checks belong to the planned job intake policy.

## Finding the code

The [router](../../src/index.ts) chooses the endpoint by method and path. The [signature helper](../../src/github/GithubWebhookSignature.ts) checks authenticity, the [parser](../../src/github/GithubWebhookParser.ts) validates consumed fields, and the [webhook handler](../../src/github/GithubWebhook.ts) maps the event and selects command text. [GitHub’s validation guide](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) explains the signature contract.

Logs attach a request ID to each HTTP call. That ID helps trace one visit to Lambda; the delivery ID connects later visits for the same work.
