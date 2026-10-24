> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# List voices

> List the reference voices registered under your API key.



## OpenAPI

````yaml /openapi.json get /v1/audio/voices
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
    get:
      tags:
        - Audio
      summary: List voices
      description: List the reference voices registered under your API key.
      operationId: listVoices
      responses:
        '200':
          description: A list of voices.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VoiceList'
        '401':
          description: Missing or invalid API key.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
    VoiceList:
      type: object
      properties:
        object:
          type: string
          enum:
            - list
          default: list
        data:
          type: array
          items:
            $ref: '#/components/schemas/VoiceListItem'
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
    VoiceListItem:
      type: object
      required:
        - voice
      properties:
        voice:
          type: string
          description: Stable ID `voice_<sha256>`.
        description:
          type: string
          nullable: true
          description: Description for the voice.
        created_at:
          type: string
          nullable: true
          description: ISO-8601 UTC timestamp.
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: 'Your Boson API key, sent as `Authorization: Bearer $BOSON_API_KEY`.'

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.