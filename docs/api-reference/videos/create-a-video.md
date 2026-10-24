> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Create a video

> Create an avatar talking-head video (async). Returns the Video object with `status: "queued"`; poll `GET /v1/videos/{video_id}` and download the rendered MP4 from `GET /v1/videos/{video_id}/content`. Provide a reference image plus exactly one driving input — `input` (audio-to-video) or `input_tts` (text-to-video). The body may be JSON or `multipart/form-data` (upload `ref_image` / `input` as raw files).



## OpenAPI

````yaml /openapi.json post /v1/videos
openapi: 3.0.3
info:
  title: Boson AI API
  description: REST API for Boson AI audio models.
  version: 1.0.0
  license:
    name: Proprietary
servers:
  - url: https://api.boson.ai
security:
  - bearerAuth: []
paths:
  /v1/videos:
    post:
      tags:
        - Videos
      summary: Create a video
      description: >-
        Create an avatar talking-head video (async). Returns the Video object
        with `status: "queued"`; poll `GET /v1/videos/{video_id}` and download
        the rendered MP4 from `GET /v1/videos/{video_id}/content`. Provide a
        reference image plus exactly one driving input — `input`
        (audio-to-video) or `input_tts` (text-to-video). The body may be JSON or
        `multipart/form-data` (upload `ref_image` / `input` as raw files).
      operationId: createVideo
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateVideoRequest'
          multipart/form-data:
            schema:
              type: object
              required:
                - ref_image
              properties:
                model:
                  type: string
                  default: higgs-avatar
                ref_image:
                  type: string
                  format: binary
                  description: >-
                    Reference image file (PNG/JPEG/WEBP), or an http(s) URL
                    string.
                input:
                  type: string
                  format: binary
                  description: >-
                    Audio-to-video driving-audio file (AAC/WAV/MP3/FLAC/OPUS),
                    or an http(s) URL string. Provide exactly one of `input` /
                    `input_tts`.
                input_tts:
                  type: string
                  description: >-
                    Text-to-video: a JSON string of a speech request. Provide
                    exactly one of `input` / `input_tts`.
                size:
                  type: string
                  default: 640x640
      responses:
        '200':
          description: The created Video object.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Video'
        '400':
          description: >-
            Invalid request (e.g. `invalid_image_format`, `invalid_size`,
            `audio_too_long`, `empty_input`, `input_too_long`).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '401':
          description: Missing or invalid API key.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '404':
          description: Unknown avatar model (`model_not_found`).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '413':
          description: Inline `ref_image` over the 10 MB cap (`payload_too_large`).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '422':
          description: Malformed body (e.g. neither or both of `input` / `input_tts`).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '429':
          description: >-
            Rate limited, or all replicas busy (`all_replicas_busy`); retry
            after `Retry-After`.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
    CreateVideoRequest:
      type: object
      required:
        - ref_image
      additionalProperties: false
      description: >-
        Provide a `ref_image` plus exactly one driving input: `input`
        (audio-to-video) or `input_tts` (text-to-video).
      properties:
        model:
          type: string
          default: higgs-avatar
          enum:
            - higgs-avatar
          description: Avatar model ID / public alias.
        ref_image:
          type: string
          description: >-
            Reference image (the face to animate): an http(s) URL, data URI, or
            base64-encoded raw image bytes. Supported formats: PNG, JPEG, WEBP.
            Inline (base64 / data-URI) payloads: max 10 MB.
        input:
          type: string
          nullable: true
          description: >-
            Audio-to-video: the driving speech audio as an http(s) URL, data
            URI, or base64-encoded raw audio bytes. Supported formats: AAC, WAV,
            MP3, FLAC, OPUS. Max duration: 60 s (it sets the output video
            length). Provide exactly one of `input` / `input_tts`.
        input_tts:
          allOf:
            - $ref: '#/components/schemas/CreateSpeechRequest'
          nullable: true
          description: >-
            Text-to-video: a speech request (the same body as `POST
            /v1/audio/speech`). The gateway synthesizes the voice and the avatar
            lip-syncs to it. The nested `stream` field is not supported. Provide
            exactly one of `input` / `input_tts`.
        size:
          type: string
          enum:
            - 640x640
            - 640x480
            - 480x640
          default: 640x640
          description: >-
            Output video size (WxH): square `640x640`, landscape `640x480`, or
            portrait `480x640`.
    Video:
      type: object
      description: A video generation job (the create / retrieve response).
      properties:
        id:
          type: string
          description: Video ID, e.g. `video_8a1f...`.
          example: video_8a1f2c3d4e5f6a7b8c9d0e1f
        object:
          type: string
          enum:
            - video
          default: video
        model:
          type: string
        status:
          type: string
          enum:
            - queued
            - in_progress
            - completed
            - failed
          description: Job status.
        progress:
          type: integer
          description: Completion percentage (0–100).
        size:
          type: string
          description: Output size (WxH), e.g. `640x640`.
        created_at:
          type: integer
          description: Unix timestamp (seconds).
        error:
          type: string
          nullable: true
          description: Error message when `status` is `failed`.
    Error:
      type: object
      properties:
        error:
          type: object
          properties:
            message:
              type: string
              description: Human-readable error message.
            type:
              type: string
              description: Error category.
            code:
              type: string
              nullable: true
              description: Machine-readable cause within `type`.
            param:
              type: string
              nullable: true
              description: The offending parameter, if any.
    CreateSpeechRequest:
      type: object
      required:
        - input
      additionalProperties: false
      properties:
        input:
          type: string
          minLength: 1
          maxLength: 50000
          description: >-
            Text to convert to speech. Up to 5,000 characters, or 50,000 with
            `stream: true`; longer input returns 400 `input_too_long`. May
            contain inline control tags, which don't count toward this limit.
            Long input is split at natural boundaries and synthesized in full.
            With `timestamps: true` the input is not split; we recommend keeping
            it to roughly 300 characters.
          example: Hello, this is a test.
        model:
          type: string
          default: higgs-tts-3
          enum:
            - higgs-tts-3
          description: >-
            TTS model ID / public alias. Resolved to the served model
            server-side.
        voice:
          type: string
          default: default
          description: >-
            Preset voice name or custom voice ID. Mutually exclusive with
            `ref_audio` / `ref_text` when explicitly provided.
        response_format:
          type: string
          enum:
            - mp3
            - opus
            - pcm
            - wav
            - aac
            - flac
          default: mp3
          description: Output audio format. Streaming requires `pcm`.
        stream:
          type: boolean
          default: false
          description: >-
            If true, stream raw PCM chunks as they are decoded. Requires
            `response_format` to be `pcm`. Speed adjustment is not supported
            when streaming. Raises the input limit to 50,000 characters, so use
            it for long input.
        ref_audio:
          type: string
          nullable: true
          description: >-
            Inline reference audio for one-off cloning: an http(s) URL, data
            URI, or base64-encoded raw audio bytes. Supported formats: AAC, WAV,
            MP3, FLAC, OPUS. Inline (base64 / data-URI) payloads: max 10 MB.
        ref_text:
          type: string
          nullable: true
          description: Recommended transcript of `ref_audio`.
        normalize:
          type: boolean
          default: true
          description: >-
            Expand non-standard words into spoken form before synthesis,
            including numbers, dates, times, currency, units, URLs, email
            addresses, phone numbers, abbreviations, and symbols. Enabled by
            default; set to false to synthesize the text exactly as written.
            Text with nothing to normalize is passed through unchanged. Inline
            tags are preserved. Replaces the deprecated `enable_tn`.
        language:
          type: string
          nullable: true
          default: null
          description: >-
            ISO 639-3 language code of the `input` text, for example `eng`
            (English) or `cmn` (Mandarin Chinese). Used for text normalization.
            Defaults to null, in which case normalization infers the language
            from the text; set it when you know the language for the most
            reliable results. An unsupported code returns 400
            `invalid_field_value`, including when normalization is disabled.
            Replaces the deprecated `tn_language` field and ISO 639-1 codes such
            as `en`.
        timestamps:
          type: boolean
          default: false
          description: >-
            Attach word-level timestamps to the response. The response becomes a
            JSON envelope carrying the word list and the audio base64-encoded in
            the requested `response_format`, instead of raw audio bytes.
            Requires `stream` to be false; combining the two returns 400
            `timestamps_streaming_unsupported`. Available for English, Chinese,
            and Spanish; other languages return a null word list. Overrides
            `normalize`, which does not run when timestamps are requested.
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: 'Your Boson API key, sent as `Authorization: Bearer $BOSON_API_KEY`.'

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.