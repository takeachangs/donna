> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Free trial credit

> What the Boson AI free trial credit covers, how to claim it, and what happens when it runs out.

New Boson AI accounts get **\$10 in free trial credit** to use on any Boson API — Higgs Realtime, Higgs TTS 3, and Higgs Avatar. No payment method is required.

## Claim your credit

Trial credit is not added to your balance automatically. Claim it once from either:

* the banner on the [API Keys](https://www.boson.ai/workspace/api-key) page, or
* the banner in [billing overview](https://www.boson.ai/workspace/billing/overview).

The claim banner in your workspace shows the exact amount available to your account.

> [!WARNING]
>
> Until you claim, your account has no active billing balance and API calls fail with a `429` `insufficient_quota` error (Realtime sessions receive an `error` event and close with code `4429`). See [Common error types](https://docs.boson.ai/api-reference/errors.md).

## Scope and expiry

* Trial credit works on **all Boson APIs** — there is no per-product restriction.
* Trial credit expires **12 months after you claim it**.
* Usage draws down your balance at the standard [pricing](https://docs.boson.ai/pricing.md) rates.

## When it runs out

When your balance reaches zero, requests are refused with the same `insufficient_quota` error until you [add credits](https://docs.boson.ai/account-billing/payment-and-credits.md). Your account and API keys are unaffected — service resumes once you add credits.

To avoid interruption, add a payment method and turn on auto-reload before the credit runs out. You can watch your balance and spend anytime in [billing overview](https://www.boson.ai/workspace/billing/overview).


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.