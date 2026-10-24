> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Get a voice

> Fetch a single reference voice by ID.



## OpenAPI

````yaml /openapi.json get /v1/audio/voices/{voice}
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
  /v1/audio/voices/{voice}:
    get:
      tags:
        - Audio
      summary: Get a voice
      description: Fetch a single reference voice by ID.
      operationId: getVoice
      parameters:
        - name: voice
          in: path
          required: true
          description: The voice ID, e.g. `voice_ab12...`.
          schema:
            type: string
      responses:
        '200':
          description: The requested voice.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VoiceObject'
        '401':
          description: Missing or invalid API key.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '404':
          description: No voice with that ID (`voice_not_found`).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
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