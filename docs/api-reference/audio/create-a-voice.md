> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Create a voice

> Register a reusable reference voice for cloning. Identical audio re-registered under the same API key returns the existing voice. Pass the returned `voice` ID to the `voice` field of `POST /v1/audio/speech` instead of sending `ref_audio` on every request.



## OpenAPI

````yaml /openapi.json post /v1/audio/voices
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
  /v1/audio/voices:
    post:
      tags:
        - Audio
      summary: Create a voice
      description: >-
        Register a reusable reference voice for cloning. Identical audio
        re-registered under the same API key returns the existing voice. Pass
        the returned `voice` ID to the `voice` field of `POST /v1/audio/speech`
        instead of sending `ref_audio` on every request.
      operationId: createVoice
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateVoiceRequest'
          multipart/form-data:
            schema:
              type: object
              required:
                - ref_audio
                - ref_text
              properties:
                ref_audio:
                  type: string
                  format: binary
                  description: Reference audio file. Max 10 MB, min 3.0 s.
                ref_text:
                  type: string
                  minLength: 1
                  description: Transcript of the reference audio.
                description:
                  type: string
                  description: Description for the voice.
      responses:
        '200':
          description: The created (or existing) voice.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VoiceObject'
        '400':
          description: Invalid request parameters.
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
    CreateVoiceRequest:
      type: object
      required:
        - ref_audio
        - ref_text
      additionalProperties: false
      properties:
        ref_audio:
          type: string
          description: >-
            Reference audio: an http(s) URL, data URI, or base64. Max 10 MB, min
            3.0 s.
        ref_text:
          type: string
          minLength: 1
          description: Transcript of the reference audio.
        description:
          type: string
          nullable: true
          description: Description for the voice.
    VoiceObject:
      type: object
      required:
        - voice
        - ref_text
      properties:
        voice:
          type: string
          description: >-
            Stable ID `voice_<sha256>`, deterministic per (API key, audio
            content).
        description:
          type: string
          nullable: true
          description: Description for the voice.
        created_at:
          type: string
          nullable: true
          description: ISO-8601 UTC timestamp.
        ref_text:
          type: string
          description: Transcript of the reference audio.
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