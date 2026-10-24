> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Pipecat

> Use Higgs Realtime as a speech-to-speech service in a Pipecat pipeline.

The `pipecat-boson` package exposes Higgs Realtime as a [Pipecat](https://docs.pipecat.ai/) speech-to-speech `LLMService`. It receives live audio or text, manages the conversation, calls tools, and streams audio or text responses. A voice pipeline does not need separate STT, LLM, and TTS services.

```text Model theme={null}
higgs-realtime
```

```text WebSocket endpoint theme={null}
wss://api.boson.ai/v1/realtime
```

## Before you begin

You need:

* Python 3.11 or newer
* A [Boson API key](https://docs.boson.ai/authentication.md) stored in `BOSON_API_KEY`
* Access to the Higgs Realtime API
* An existing Pipecat application with an audio transport

> [!WARNING]
>
> Keep the Boson API key on the server. Never embed it in a browser or mobile client.

## Install the package

During the preview, install the package from GitHub. The repository might still be private, in which case you need a GitHub account with access:

```bash uv theme={null}
uv add "pipecat-boson @ git+ssh://git@github.com/boson-ai/pipecat-boson.git"
```

```bash pip theme={null}
pip install "pipecat-boson @ git+ssh://git@github.com/boson-ai/pipecat-boson.git"
```

For HTTPS, replace the source URL with `git+https://github.com/boson-ai/pipecat-boson.git`.

To develop the package or run its included example:

```bash theme={null}
git clone git@github.com:boson-ai/pipecat-boson.git
cd pipecat-boson
uv sync --extra dev
```

To use a local checkout from another `uv` project:

```bash theme={null}
uv add --editable ../pipecat-boson
```

The package supports `pipecat-ai>=1.4.0,<2`.

## Configure the connection

Set the API key, WebSocket endpoint, and model ID in your server environment:

```bash theme={null}
export BOSON_API_KEY=bai-xxxx
export BOSON_REALTIME_URL=wss://api.boson.ai/v1/realtime
export BOSON_REALTIME_MODEL=higgs-realtime
```

Create the realtime service:

```python theme={null}
import os

from pipecat_boson.realtime import BosonRealtimeLLMService

llm = BosonRealtimeLLMService(
    url=os.environ["BOSON_REALTIME_URL"],
    api_key=os.environ["BOSON_API_KEY"],
    model=os.environ["BOSON_REALTIME_MODEL"],
    voice="default",
    instructions="You are a concise and helpful voice assistant.",
)
```

## Add the service to a pipeline

The following example assumes that `transport` is an existing Pipecat audio transport:

```python theme={null}
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
)
from pipecat.workers.runner import WorkerRunner


async def run_bot(transport, llm):
    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        realtime_service_mode=True,
    )

    pipeline = Pipeline(
        [
            transport.input(),
            user_aggregator,
            llm,
            transport.output(),
            assistant_aggregator,
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
        ),
    )

    runner = WorkerRunner()
    await runner.add_workers(worker)
    await runner.run()
```

`realtime_service_mode=True` lets the context aggregators follow the server-driven turn lifecycle. Do not add separate STT or TTS services around `BosonRealtimeLLMService`.

Call `run_bot(transport, llm)` from your application's async entry point.

> [!TIP]
>
> Higgs Realtime responds after server VAD detects the end of a user turn. If the assistant should speak first, queue an `LLMRunFrame` after the client is ready, as demonstrated by the included browser example.

## Run the browser example

From the repository checkout created above, copy the example environment file:

```bash theme={null}
cp .env.example .env
```

Set `BOSON_API_KEY`, `BOSON_REALTIME_URL`, and `BOSON_REALTIME_MODEL` in `.env`, then start the example:

```bash WebRTC theme={null}
uv run --extra webrtc \
  python examples/pipecat_boson_realtime_agent.py \
    -t webrtc \
    --host 127.0.0.1 \
    --port 7860
```

```bash WebSocket theme={null}
uv run --extra webrtc \
  python examples/pipecat_boson_realtime_agent.py \
    -t websocket \
    --host localhost \
    --port 7860
```

Open `http://localhost:7860` and connect your microphone. Use the WebSocket transport if WebRTC ICE cannot reach the server, and select **WebSocket** in the page before connecting. Both commands use the `webrtc` extra because it also installs the Pipecat runner used by the browser example.

## Receive user transcripts

Set an input transcription model to receive finalized user transcripts as Pipecat `TranscriptionFrame` objects. See [Model selection](https://docs.boson.ai/models/higgs-realtime/guides/connections-and-sessions.md#model-selection) for what transcription adds to a session:

```python theme={null}
llm = BosonRealtimeLLMService(
    url=os.environ["BOSON_REALTIME_URL"],
    api_key=os.environ["BOSON_API_KEY"],
    model=os.environ["BOSON_REALTIME_MODEL"],
    input_audio_transcription={
        "model": "higgs-stt-3.1",
        "language": "en",
    },
)
```

Omitting `input_audio_transcription`, passing `None`, or passing a dictionary without a non-empty `model` suppresses client-facing user transcript events. Higgs Realtime still understands the audio and can respond.

## Call Python functions

Declare an async Python function with typed arguments and return its result through `result_callback`:

```python theme={null}
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.services.llm_service import FunctionCallParams


async def get_weather(
    params: FunctionCallParams,
    location: str,
) -> None:
    """Get the current weather for a location.

    Args:
        location: City or place name.
    """
    await params.result_callback(
        {
            "location": location,
            "condition": "sunny",
            "temperature_c": 22,
        }
    )


tools = [get_weather]

llm = BosonRealtimeLLMService(
    url=os.environ["BOSON_REALTIME_URL"],
    api_key=os.environ["BOSON_API_KEY"],
    model=os.environ["BOSON_REALTIME_MODEL"],
    instructions="Use get_weather when the user asks about weather.",
    tools=tools,
)

context = LLMContext(tools=tools)
```

Pass the same tool list to the service and the context. The service advertises and registers the handlers for the Higgs Realtime session, while `LLMContext` keeps the tool definitions with the conversation state. After the function completes, Higgs Realtime continues the response with its result.

For the underlying event flow, see [Tool use](https://docs.boson.ai/models/higgs-realtime/guides/tool-calling.md).

## Configure turn detection

Server VAD is enabled by default. It detects the end of the user's turn, creates a response, and interrupts an active response when the user starts speaking. For most voice agents, keep the default settings — see [Turn detection and interruptions](https://docs.boson.ai/models/higgs-realtime/guides/turn-detection-and-interruptions.md) for what each parameter does.

**Server VAD**

Override the thresholds only when the default behavior does not fit the application:

```python theme={null}
turn_detection = {
    "type": "server_vad",
    "prefix_padding_ms": 300,
    "silence_duration_ms": 500,
    "threshold": 0.85,
}

llm = BosonRealtimeLLMService(
    url=os.environ["BOSON_REALTIME_URL"],
    api_key=os.environ["BOSON_API_KEY"],
    turn_detection=turn_detection,
)
```

**Semantic VAD**

Higgs Realtime also supports OpenAI-compatible semantic VAD, which judges whether the user has truly finished speaking:

```python theme={null}
semantic_turn_detection = {
    "type": "semantic_vad",
}

llm = BosonRealtimeLLMService(
    url=os.environ["BOSON_REALTIME_URL"],
    api_key=os.environ["BOSON_API_KEY"],
    turn_detection=semantic_turn_detection,
)
```

## Use text-only output

Pass `output_modalities=["text"]` when constructing the service. Text-only sessions emit streamed `LLMTextFrame` objects and no audio frames.

The service supports exactly one session output modality: `["audio"]` or `["text"]`. Mixed output modalities and per-response modality overrides are not supported.

## Handle session events

Use Pipecat service event handlers to observe the Higgs Realtime session lifecycle:

```python theme={null}
def register_session_handlers(llm):
    @llm.event_handler("on_session_created")
    async def on_session_created(service, event):
        print("Session:", event.session.id)

    @llm.event_handler("on_session_terminated")
    async def on_session_terminated(service, event_type, event):
        print("Session terminated:", event_type)
```

Call `register_session_handlers(llm)` before starting `WorkerRunner`. The integration reports terminal session events but does not close the Pipecat transport automatically.

> [!NOTE]
>
> Keep `on_session_created` handlers fast. Session setup waits for this handler to return.

`on_session_terminated` receives [`session.idle_timeout`](https://docs.boson.ai/api-reference/realtime/server-events#session-idle_timeout) or [`session.max_duration_reached`](https://docs.boson.ai/api-reference/realtime/server-events#session-max_duration_reached).

## Supported options

Connection options:

| Parameter | Default | Description |
| - | - | - |
| `url` | Required | Higgs Realtime WebSocket endpoint. |
| `api_key` | Required for the hosted API | Boson API key sent as a Bearer token. |
| `model` | `"higgs-realtime"` | Realtime model ID sent when the session is configured. |

Optional session settings supported by Higgs Realtime:

| Parameter | Default | Description |
| - | - | - |
| `voice` | `"default"` | Voice preset or voice ID used for audio output. See [Audio and voices](https://docs.boson.ai/models/higgs-realtime/guides/audio-and-voices.md#voices). |
| `instructions` | Helpful assistant prompt | System instructions used to initialize the conversation. |
| `output_modalities` | `["audio"]` | Exactly `["audio"]` or `["text"]`. |
| `temperature` | `0.7` | Sampling temperature used for model responses. |
| `max_output_tokens` | `"inf"` | Maximum response tokens. Numeric values are capped at `4096`. |
| `tools` | Not set | Python functions or Pipecat-compatible tool definitions. |
| `tool_choice` | `"auto"` | Tool selection behavior used when tools are available. |
| `turn_detection` | Server VAD | OpenAI-compatible `server_vad` or `semantic_vad` configuration. |
| `input_audio_transcription` | Not set | Transcription dictionary. A non-empty `model` enables client-facing user transcript events. |
| `input_audio_transcription_model` | `""` | Convenience option for the transcription model. |
| `input_audio_transcription_language` | `None` | Convenience option for the transcription language. |
| `input_audio_noise_reduction` | Not set | OpenAI-compatible `{"type": "near_field"}` or `{"type": "far_field"}` input noise reduction setting. The corresponding type string is also accepted. |
| `truncation` | `"auto"` | `"auto"` enables smart context summarization when the selected model publishes a context limit; `"disabled"` turns it off. |

This Pipecat integration sends and receives 24 kHz PCM audio.

## Next steps

> **[Connections and sessions](https://docs.boson.ai/models/higgs-realtime/guides/connections-and-sessions.md)**
>
> Understand the session settings these options map to.

> **[Realtime API reference](https://docs.boson.ai/api-reference/realtime/overview.md)**
>
> Look up the underlying protocol, event catalog, and payload schemas.

> **[Pipecat documentation](https://docs.pipecat.ai/)**
>
> Transports, processors, and the rest of the Pipecat framework.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.