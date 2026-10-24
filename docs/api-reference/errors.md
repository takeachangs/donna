> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Common error types

> HTTP statuses, the error body shape, and every error code with its fix.

## Error format

REST API errors return a JSON body with a single `error` object:

```json theme={null}
{
  "error": {
    "message": "Your API key is not linked to an active billing account. Please go to Boson.ai to set up billing and purchase credits.",
    "type": "insufficient_quota",
    "param": null,
    "code": "no_billing_account"
  }
}
```

**error** `object`

`message` (string, human-readable), `type` (string, error category), `param` (string or null, the offending parameter if any), `code` (string or null, machine-readable cause).

Handle errors by `type` (the stable category) and use `code` to distinguish causes within it.

## Error types

| Status | `type` | Cause | Fix |
| - | - | - | - |
| `401` | `authentication_error` | Problem with your API key — missing, malformed, or revoked (`code: "invalid_api_key"`). | Check the `Authorization: Bearer` header and the key in your [workspace](https://www.boson.ai/workspace/api-key). See [Authentication](https://docs.boson.ai/authentication.md). |
| `400` / `403` | `invalid_request_error` | Malformed request, or the key lacks access to the requested model. | Fix the request per the `message`; for model access, contact support. |
| `429` | `rate_limit_error` | Too many requests — **transient**. | Retry with backoff. |
| `429` | `insufficient_quota` | Billing refusal — **not transient**; retrying cannot succeed until the account changes. See the code table below. | Resolve in [workspace billing](https://www.boson.ai/workspace/billing/overview), not in code. |
| `5xx` | `api_error` | Something failed on the server side. | Retry later; report if persistent. |

> [!WARNING]
>
> Both `rate_limit_error` and `insufficient_quota` arrive as `429` — check `error.type` before retrying. A `rate_limit_error` recovers on its own; an `insufficient_quota` never does.

### `insufficient_quota` codes

| `code` | Meaning | Fix |
| - | - | - |
| `no_billing_account` | The key isn't linked to an active billing account — typically a new account that hasn't claimed credit. | [Claim your free trial credit](https://docs.boson.ai/free-trial-credit.md). |
| `insufficient_quota` | Credits are exhausted. | [Add credits](https://docs.boson.ai/account-billing/payment-and-credits.md). |
| `monthly_cap_reached` | Your own [monthly spend cap](https://docs.boson.ai/account-billing/usage-and-limits.md) is reached. | Raise or remove the cap; it also resets at the start of each month (UTC). |
| `contract_ended` | The account's contract has ended. | Contact your Boson AI representative. |

## Realtime errors

The Realtime WebSocket signals problems with an [`error` server event](https://docs.boson.ai/api-reference/realtime/server-events#error) carrying the same `type` / `code` / `message` / `param` fields. Billing refusals use `type: "insufficient_quota"` and are followed by WebSocket close code `4429`; invalid or expired keys close with code `3000`. See the [close-code table](https://docs.boson.ai/api-reference/realtime/overview.md) for all codes.

## Product-specific request errors

* [Avatar input limits and request errors](https://docs.boson.ai/models/higgs-avatar/input-options.md#input-limits)
* [Avatar realtime session errors](https://docs.boson.ai/api-reference/avatar-realtime/overview.md#errors)
* [Realtime session limits](https://docs.boson.ai/models/higgs-realtime/guides/connections-and-sessions.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.