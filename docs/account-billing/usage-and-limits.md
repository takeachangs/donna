> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Usage & limits

> Track spend, set a monthly cap, and understand what happens when a limit is reached.

## Track your usage

The [usage page](https://www.boson.ai/workspace/billing/usage) shows your spend over time and a summary by model. Your current balance and recent activity are on [billing overview](https://www.boson.ai/workspace/billing/overview).

## Spend limits

From the usage page you can set:

* a **monthly cap** — a hard ceiling on monthly spend, and
* a **warning threshold** — you're alerted when spend crosses it, before the cap is reached.

While a monthly cap is reached, requests are refused even if your balance is positive. The cap resets at the beginning of each month (UTC); to resume sooner, raise or remove the cap.

## What a refusal looks like

Whether the cause is an empty balance or a reached cap, the API responds the same way:

* REST requests fail with **`429`** and an error body with `"type": "insufficient_quota"`.
* Realtime sessions receive an `error` event (`type: "insufficient_quota"`) with the upstream message, then close with WebSocket code `4429`.

See [Common error types](https://docs.boson.ai/api-reference/errors.md) for the full error reference, and [Payment & credits](https://docs.boson.ai/account-billing/payment-and-credits.md) for how to add credits.

## Concurrency

Realtime connections are also subject to a concurrency limit: exceeding it closes the WebSocket with code `1013` (retry later). See the [Realtime API overview](https://docs.boson.ai/api-reference/realtime/overview.md) for the close-code table.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.