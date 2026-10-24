> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Delete a voice

> Delete one of your own reference voices. The reference audio is removed, so the voice stops working on /v1/audio/speech and no longer appears in the voice list. Preset voices cannot be deleted. Because the ID is derived from the audio itself, re-creating the voice with the same `ref_audio` returns the same ID.



## OpenAPI

````yaml /openapi.json delete /v1/audio/voices/{voice}
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
    delete:
      tags:
        - Audio
      summary: Delete a voice
      description: >-
        Delete one of your own reference voices. The reference audio is removed,
        so the voice stops working on /v1/audio/speech and no longer appears in
        the voice list. Preset voices cannot be deleted. Because the ID is
        derived from the audio itself, re-creating the voice with the same
        `ref_audio` returns the same ID.
      operationId: deleteVoice
      parameters:
        - name: voice
          in: path
          required: true
          description: The voice ID, e.g. `voice_ab12...`.
          schema:
            type: string
      responses:
        '200':
          description: The voice was deleted.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VoiceDeleted'
        '401':
          description: Missing or invalid API key.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '403':
          description: >-
            The voice is a shared preset and cannot be deleted
            (`voice_not_deletable`).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '404':
          description: >-
            No voice with that ID, it belongs to another key, or it was already
            deleted (`voice_not_found`). The three are not distinguished, so
            this endpoint cannot be used to discover another account's voice
            IDs.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
    VoiceDeleted:
      type: object
      required:
        - voice_id
        - object
        - deleted
      properties:
        voice_id:
          type: string
          description: The deleted voice's ID.
        object:
          type: string
          enum:
            - voice
        deleted:
          type: boolean
          enum:
            - true
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