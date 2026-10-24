> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Authentication

> Authenticate Boson API requests with a Bearer token.

## Get an API key

Create keys from the [API Keys](https://www.boson.ai/workspace/api-key) page in your workspace: click **Create API Key**, name it, and copy the key (format `bai-xxxx`). New to Boson AI? Follow [Set up your account](https://docs.boson.ai/set-up-your-account.md) for the full checklist — account, key, and free trial credit.

> [!WARNING]
>
> Treat API keys like passwords. Never commit keys to source control, never log them, and never embed them in client-side code shipped to browsers or mobile apps.

> [!NOTE]
>
> Building a browser or mobile Realtime client? Your trusted server must exchange its long-lived key for a short-lived [client secret](https://docs.boson.ai/api-reference/realtime/client-secrets.md).

## Store keys safely

Read the key from an environment variable, secret manager, or deployment config. Recommended patterns:

* **Quick local test**: set the key in your shell for the current session:

  ```bash theme={null}
  export BOSON_API_KEY=bai-xxxx
  ```

* **Local development**: use a `.env` file loaded by `direnv`, `dotenv`, or your shell. Add `.env` to `.gitignore`.

* **Servers**: inject through your platform's secret store (AWS Secrets Manager, GCP Secret Manager, Vercel env vars, Fly secrets, Kubernetes Secrets).

* **CI**: store as a masked CI secret. Avoid printing the value in build logs.

## Sending a server-side request

From a trusted server, pass the key in the `Authorization` header on every API request. Browser and mobile Realtime clients must use a short-lived client secret instead.

```bash cURL theme={null}
curl https://api.boson.ai/v1/audio/speech \
  -H "Authorization: Bearer $BOSON_API_KEY"
```

```python Python theme={null}
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.boson.ai/v1",
    api_key=os.environ["BOSON_API_KEY"],
)
```

```typescript TypeScript theme={null}
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.boson.ai/v1",
  apiKey: process.env.BOSON_API_KEY,
});
```

## Common errors

The API returns `401 Unauthorized` with `error.type: "authentication_error"` and `error.code: "invalid_api_key"` when there is a problem with your API key — missing, malformed, or revoked. Check the `Authorization: Bearer` header and the key in your [workspace](https://www.boson.ai/workspace/api-key).

A `429` with `insufficient_quota` is a billing problem, not a key problem — the key is fine but the account has no available balance. Claim your [free trial credit](https://docs.boson.ai/free-trial-credit.md) or add credits in [workspace billing](https://www.boson.ai/workspace/billing/overview). See [Common error types](https://docs.boson.ai/api-reference/errors.md) for the full reference.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.