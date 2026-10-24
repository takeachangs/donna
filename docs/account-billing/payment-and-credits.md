> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Payment & credits

> How Boson AI billing works: prepaid credits, payment methods, auto-reload, and invoices.

Boson AI billing is **prepaid**: you add credits to your balance, and API usage draws the balance down at the standard [pricing](https://docs.boson.ai/pricing.md) rates. When the balance reaches zero, requests are refused until you add more — see [Common error types](https://docs.boson.ai/api-reference/errors.md).

New accounts start with [free trial credit](https://docs.boson.ai/free-trial-credit.md); everything below applies once you're ready to go beyond it.

## Add credits

Buy credits from [billing overview](https://www.boson.ai/workspace/billing/overview). Each purchase is between \$5 and \$100 — pick a preset or enter a custom amount. Taxes are estimated at checkout and may differ from the final amount.

## Payment methods

Add and manage cards on the [billing payment page](https://www.boson.ai/workspace/billing/payment). Card details are handled by Stripe; Boson AI does not store your card number.

## Auto-reload

Turn on auto-reload from [billing overview](https://www.boson.ai/workspace/billing/overview) so service never stops because a balance quietly ran out mid-project. You configure two values:

* **When balance below** — the threshold that triggers a reload. The minimum is \$5.
* **Bring balance up to** — the balance target a reload restores. The maximum is \$100, and the target must sit \$30 or more above the threshold.

Whenever your balance falls below the threshold, it is automatically recharged up to the target using your saved payment method, and you're notified by email whether the reload succeeded or failed. The workspace also warns you when your balance runs low either way.

## Invoices and transactions

The [billing payment page](https://www.boson.ai/workspace/billing/payment) also holds your **transactions** and **invoices** history.

## When payment lapses

If your balance is empty (or a [spend cap](https://docs.boson.ai/account-billing/usage-and-limits.md) is hit), API requests fail with a `429` `insufficient_quota` error, and Realtime sessions receive an `error` event and close with code `4429`. Add credits to resume service.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.