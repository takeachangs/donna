> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Set up your account

> Create a Boson AI account, get an API key, claim your free trial credit, and make your first call.

Everything you need before your first API call, in order. The whole flow takes a few minutes and does not require a payment method.

**1. Create a Boson AI account**

Go to [boson.ai/workspace](https://www.boson.ai/workspace) and sign in with Google or an email verification code. Complete the account setup and verification steps.

**2. Create an API key**

Open the [API Keys](https://www.boson.ai/workspace/api-key) page, click **Create API Key**, and give the key a descriptive name. Copy the key when it is shown — Boson API keys use the format `bai-xxxx`.

Store it securely and never commit it to source control. See [Authentication](https://docs.boson.ai/authentication.md) for storage patterns and how requests are authenticated.

**3. Claim your free trial credit**

New accounts get **\$10 in free trial credit**, but it is not added automatically — claim it from the banner on the [API Keys](https://www.boson.ai/workspace/api-key) page or in [billing overview](https://www.boson.ai/workspace/billing/overview). No payment method is required.

> [!WARNING]
>
> Don't skip this step. API calls from an account without claimed credit or a positive balance fail with a `429` `insufficient_quota` error. See [Free trial credit](https://docs.boson.ai/free-trial-credit.md).

**4. Make your first call**

Pick the quickstart for what you're building:

> **[Higgs Realtime](https://docs.boson.ai/models/higgs-realtime/quickstart.md)**
>
> Hear a live spoken reply over WebSocket.

> **[Higgs TTS 3](https://docs.boson.ai/models/higgs-tts/overview.md#generate-speech-with-the-api)**
>
> Generate speech from text.

> **[Higgs Avatar](https://docs.boson.ai/models/higgs-avatar/overview.md#quickstart)**
>
> Create a talking-head video.

**5. Optional: set up payment and limits**

When you're ready to go beyond the trial credit, [add a payment method and credits](https://docs.boson.ai/account-billing/payment-and-credits.md), turn on auto-reload so service never stops mid-project, and [set a monthly spend cap](https://docs.boson.ai/account-billing/usage-and-limits.md) if you want a hard ceiling.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.