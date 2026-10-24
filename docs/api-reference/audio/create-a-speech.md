> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Create a speech

> Generate speech audio from text. Returns an audio file, or a stream of raw PCM chunks when `stream` is `true`. The body may be JSON or `multipart/form-data` — the latter lets you upload `ref_audio` as a raw file instead of base64-encoding it.



## OpenAPI

````yaml /openapi.json post /v1/audio/speech
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
  /v1/audio/speech:
    post:
      tags:
        - Audio
      summary: Create a speech
      description: >-
        Generate speech audio from text. Returns an audio file, or a stream of
        raw PCM chunks when `stream` is `true`. The body may be JSON or
        `multipart/form-data` — the latter lets you upload `ref_audio` as a raw
        file instead of base64-encoding it.
      operationId: createSpeech
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateSpeechRequest'
          multipart/form-data:
            schema:
              type: object
              required:
                - input
              properties:
                input:
                  type: string
                  description: Text to convert to speech.
                model:
                  type: string
                  default: higgs-tts-3
                voice:
                  type: string
                  default: default
                response_format:
                  type: string
                  default: mp3
                ref_audio:
                  type: string
                  format: binary
                  description: >-
                    Reference audio file for one-off cloning
                    (AAC/WAV/MP3/FLAC/OPUS), or an http(s) URL string.
                ref_text:
                  type: string
                  description: Recommended transcript of `ref_audio`.
      responses:
        '200':
          description: >-
            Generated audio. The content type depends on `response_format`. When
            `timestamps` is true the response is `application/json` instead,
            carrying the audio base64-encoded alongside the word list.
          content:
            audio/mpeg:
              schema:
                type: string
                format: binary
            audio/ogg:
              schema:
                type: string
                format: binary
            audio/wav:
              schema:
                type: string
                format: binary
            audio/aac:
              schema:
                type: string
                format: binary
            audio/flac:
              schema:
                type: string
                format: binary
            audio/L16:
              schema:
                type: string
                format: binary
            application/json:
              schema:
                $ref: '#/components/schemas/CreateSpeechTimestampsResponse'
        '400':
          description: Invalid request parameters (e.g. `input_too_long`).
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
components:
  schemas:
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
    CreateSpeechTimestampsResponse:
      type: object
      description: Returned when `timestamps` is true, in place of raw audio bytes.
      properties:
        audio:
          type: string
          format: byte
          description: >-
            Base64-encoded audio in the requested `response_format`. Decode it
            before writing it to a file.
        response_format:
          type: string
          enum:
            - mp3
            - opus
            - pcm
            - wav
            - aac
            - flac
          description: >-
            Format of the encoded `audio`, echoing the requested
            `response_format`.
        input:
          type: string
          description: The text the model was given, which the timestamps index into.
        timestamps:
          type: array
          nullable: true
          description: >-
            One entry per word, in order. Empty when the audio contains no
            speech to align, and null when alignment was unavailable. Clients
            must handle both. Chinese returns one entry per character rather
            than per word.
          items:
            type: object
            properties:
              word:
                type: string
                description: The word as it appears in `input`.
              start:
                type: number
                format: float
                description: Start offset in seconds from the beginning of the audio.
              end:
                type: number
                format: float
                description: End offset in seconds from the beginning of the audio.
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
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: 'Your Boson API key, sent as `Authorization: Bearer $BOSON_API_KEY`.'

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.