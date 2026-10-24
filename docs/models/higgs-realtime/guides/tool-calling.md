> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Tool use

> Give the model function tools your application executes, and server-side tools like web search that Higgs Realtime runs for you.

Higgs Realtime supports two kinds of tools, declared together in `session.tools`:

* **Function tools** (`"type": "function"`): you define them, and your client executes each call and returns the result.
* **Server-side tools**: built in and executed by Higgs Realtime. Today that is [web search](#web-search) (`"type": "web_search"`).

> [!NOTE]
>
> Server-side tools (`web_search`) are executed automatically by Higgs Realtime — you don't need to handle their calls or return their results. Only custom `function` tools require client-side handling.

## Function tools

Declare function tools in `session.update`:

```json theme={null}
{
  "tools": [
    {
      "type": "function",
      "name": "get_weather",
      "description": "Get current weather for a city",
      "parameters": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ]
}
```

When the model calls a tool, the server streams [`response.function_call_arguments.delta`](https://docs.boson.ai/api-reference/realtime/server-events#response-function_call_arguments-delta) events and finishes with [`response.function_call_arguments.done`](https://docs.boson.ai/api-reference/realtime/server-events#response-function_call_arguments-done), then ends the response with [`response.done`](https://docs.boson.ai/api-reference/realtime/server-events#response-done) carrying the completed `function_call` item (`call_id`, `name`, `arguments`). It is now your client's turn:

1. Execute the function locally with the provided arguments.
2. Return the result with [`conversation.item.create`](https://docs.boson.ai/api-reference/realtime/client-events#conversation-item-create) (`type: "function_call_output"`, echoing the `call_id`).
3. Send [`response.create`](https://docs.boson.ai/api-reference/realtime/client-events#response-create) — the model continues with the result and speaks the answer.

The core handler flow is shown below. Pass the connected WebSocket as `ws`:

```python theme={null}
import json

TOOLS = [
    {
        "type": "function",
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    }
]


def get_weather(city: str) -> dict:
    ...  # your implementation


async def run_tool_turn(ws):
    # Declare the tool and ask a question that needs it.
    await ws.send(json.dumps({
        "type": "session.update",
        "session": {
            "model": "higgs-realtime",
            "tools": TOOLS,
            "instructions": "Use the available tools when needed.",
        },
    }))
    await ws.send(json.dumps({
        "type": "conversation.item.create",
        "item": {
            "type": "message",
            "role": "user",
            "content": [
                {"type": "input_text", "text": "What's the weather in Tokyo?"}
            ],
        },
    }))
    await ws.send(json.dumps({"type": "response.create"}))

    async for msg in ws:
        event = json.loads(msg)

        if event["type"] == "response.done":
            # A response ending in a tool call carries the function_call item.
            # Server-side tools (executor "server") need no client handling.
            calls = [
                item
                for item in event["response"]["output"]
                if item.get("type") == "function_call"
                and item.get("executor") == "client"
            ]
            if not calls:
                break  # Final spoken reply finished.

            call = calls[0]
            result = get_weather(**json.loads(call["arguments"]))  # 1. Execute.
            await ws.send(json.dumps({
                "type": "conversation.item.create",  # 2. Return the result.
                "item": {
                    "type": "function_call_output",
                    "call_id": call["call_id"],
                    "output": json.dumps(result),
                },
            }))
            await ws.send(
                json.dumps({"type": "response.create"})
            )  # 3. Continue.

        elif event["type"] == "response.output_audio.delta":
            ...  # Play audio as usual.
```

## Web search

`web_search` is a built-in, server-side tool. Add it to `session.tools` and the model can look things up on the web when a question needs current or factual information it doesn't reliably know — prices, news, scores, schedules.

### Enable web search

Declare the tool in [`session.update`](https://docs.boson.ai/api-reference/realtime/client-events#session-update), and use `instructions` to tell the model when to search:

```json theme={null}
{
  "type": "session.update",
  "session": {
    "model": "higgs-realtime",
    "instructions": "You are a helpful assistant. Search the web for anything current or time-sensitive (news, prices, weather, schedules, scores) and for facts you aren't sure of.",
    "tools": [{ "type": "web_search" }]
  }
}
```

That's all a client needs. When the model decides to search, it first says a short preamble in its own words (for example, "Let me look that up."), the server runs the search, and the model then speaks the answer.

### Parameters

All parameters are optional. Without any, the search covers the whole web.

| Parameter | Type | Description |
| - | - | - |
| `allowed_domains` | `string[]` | Only return results from these domains. Max 5. |
| `excluded_domains` | `string[]` | Never return results from these domains. Max 5. |
| `location` | `object` | Bias results toward a country: `{ "country": "US" }`. `user_location` is accepted as an alias. |

```json theme={null}
{
  "type": "session.update",
  "session": {
    "tools": [
      {
        "type": "web_search",
        "allowed_domains": ["weather.gov", "noaa.gov"],
        "location": { "country": "US" }
      }
    ]
  }
}
```

* **Domains** are bare hostnames such as `example.com` — no scheme, path, or query (`https://example.com/news` is rejected). A domain also matches its subdomains: `noaa.gov` covers `www.weather.noaa.gov`.
* **`allowed_domains` and `excluded_domains` are mutually exclusive** — set one or the other. An empty list means no restriction.
* **`location.country`** is an ISO 3166-1 alpha-2 code (`US`, `GB`, `JP`; case-insensitive). Full country names such as `"United States"` are rejected.

> [!TIP]
>
> Restricting domains narrows results sharply, and a scoped search can return few results or none. Use `allowed_domains` only when sources genuinely must be restricted. To merely *prefer* a source, say so in `instructions` instead.

An invalid configuration returns an [`error`](https://docs.boson.ai/api-reference/realtime/server-events#error) event, and the session keeps its previous configuration.

### What your client sees

A search shows up on the wire as an ordinary `function_call` item named `web_search`, with `"executor": "server"`. You don't need to act on it — the events are there so you can show progress (for example a "Searching…" indicator) or log what was searched.

1. **Preamble.** The model speaks a short filler in its own words (for example, "Let me check that for you.") as an assistant message.
2. **The call.** [`response.output_item.added`](https://docs.boson.ai/api-reference/realtime/server-events#response-output_item-added) carries the `function_call` item (`name: "web_search"`, `executor: "server"`), followed by [`response.function_call_arguments.delta`](https://docs.boson.ai/api-reference/realtime/server-events#response-function_call_arguments-delta) / [`.done`](https://docs.boson.ai/api-reference/realtime/server-events#response-function_call_arguments-done). The arguments are the model's search request, e.g. `{"objective": "Find tonight's weather in Tokyo", "queries": ["Tokyo weather tonight"]}`.
3. **The response ends.** [`response.done`](https://docs.boson.ai/api-reference/realtime/server-events#response-done) arrives right after the preamble — it doesn't wait for the search.
4. **The result.** When the search finishes, the server adds a `function_call_output` item with the same `call_id` and announces it with [`conversation.item.added`](https://docs.boson.ai/api-reference/realtime/server-events#conversation-item-added).
5. **The answer.** The server starts a new response on its own, and the model speaks the answer. If the user starts talking before that, the result is folded into the reply to what they said instead.

```json theme={null}
{
  "type": "response.output_item.added",
  "response_id": "resp_...",
  "output_index": 1,
  "item": {
    "id": "...",
    "object": "realtime.item",
    "type": "function_call",
    "status": "in_progress",
    "name": "web_search",
    "call_id": "call_...",
    "arguments": "",
    "executor": "server"
  }
}
```

> [!WARNING]
>
> For a `web_search` call, **don't** send a `function_call_output` and **don't** send `response.create` to continue — the server does both for you. Sending `response.create` while a search is still running starts a new response that doesn't have the result yet, and the model may search again.

Other behavior worth knowing:

* **Interruptions.** Once the user has heard the preamble, the search runs to completion and its result is delivered even if they barge in. If the user interrupts before any audio plays, the search doesn't run; you may then see a `web_search` `function_call` with no matching `function_call_output`.
* **Failures.** If the search fails or times out, the `function_call_output` says so and the model answers from what it already knows.
* **The output text is for the model.** It lists up to five ranked results (title, URL, and a short excerpt) per search. Treat its format as unstable — don't parse it.
* **The name is reserved.** Declare `{"type": "web_search"}` once, and don't name one of your own function tools `web_search`.

## Combining multiple tools

A session can mix `web_search` with your own `function` tools. The model chooses between them per turn, and only the function tools need client-side handling.

```json theme={null}
{
  "type": "session.update",
  "session": {
    "model": "higgs-realtime",
    "instructions": "You are a travel assistant on a phone call. Keep replies short and conversational. When the user asks about their own reservation, look it up with get_booking. For current information such as flight status, weather, or entry requirements, search the web.",
    "tools": [
      { "type": "web_search" },
      {
        "type": "function",
        "name": "get_booking",
        "description": "Look up the user's booking by confirmation code",
        "parameters": {
          "type": "object",
          "properties": { "confirmation_code": { "type": "string" } },
          "required": ["confirmation_code"]
        }
      }
    ]
  }
}
```

Every `function_call` item carries `executor`. Handle the ones marked `"client"` as described in [Function tools](#function-tools), and skip the ones marked `"server"`:

```python theme={null}
import json


async def handle_response_done(ws, event):
    calls = [
        item
        for item in event["response"]["output"]
        if item.get("type") == "function_call"
        and item.get("executor") == "client"  # Skip server-side tools like web_search.
    ]
    if not calls:
        return  # Nothing for the client to do.

    for call in calls:
        result = run_my_function(call["name"], json.loads(call["arguments"]))
        await ws.send(json.dumps({
            "type": "conversation.item.create",
            "item": {
                "type": "function_call_output",
                "call_id": call["call_id"],
                "output": json.dumps(result),
            },
        }))
    await ws.send(json.dumps({"type": "response.create"}))
```


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.