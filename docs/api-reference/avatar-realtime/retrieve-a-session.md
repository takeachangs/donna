> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Retrieve a session

> Current state of a session. A session you did not create (with this API key) is reported as not found. Ended sessions stay retrievable until a few minutes after `expires_at`, then `404`.



## OpenAPI

````yaml /openapi.json get /v1/avatar/sessions/{session_id}
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
  /v1/avatar/sessions/{session_id}:
    get:
      tags:
        - Avatar Realtime
      summary: Retrieve a session
      description: >-
        Current state of a session. A session you did not create (with this API
        key) is reported as not found. Ended sessions stay retrievable until a
        few minutes after `expires_at`, then `404`.
      operationId: getAvatarSession
      parameters:
        - name: session_id
          in: path
          required: true
          schema:
            type: string
          description: >-
            The session ID returned by `POST /v1/avatar/sessions`, e.g.
            `avrt_...`.
      responses:
        '200':
          description: The session object.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AvatarSession'
        '401':
          description: Missing or invalid API key.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '404':
          description: No session with that ID for this API key (`session_not_found`).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '503':
          description: >-
            Temporarily unavailable (`service_unavailable`, with `Retry-After`),
            or realtime avatar is not enabled on this server (`not_configured`).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
    AvatarSession:
      type: object
      description: A realtime avatar session (the create / retrieve / release response).
      properties:
        id:
          type: string
          description: Session ID, e.g. `avrt_...`.
          example: avrt_3f9c2a7e8b1d4c6f
        object:
          type: string
          enum:
            - avatar.realtime.session
          default: avatar.realtime.session
        status:
          type: string
          enum:
            - active
            - releasing
            - terminated
          description: >-
            `active`: the avatar is in the room. `releasing`: a release was
            requested and is not confirmed yet. `terminated`: the session has
            ended (released, expired, room emptied, or ended by Boson for
            another reason).
        model:
          type: string
          example: higgs-avatar
        avatar_id:
          type: string
          example: builtin_claire_v1
        avatar_identity:
          type: string
          description: >-
            The LiveKit identity the avatar joined as
            (`transport.participant_identity`).
          example: boson-avatar-agent
        created_at:
          type: string
          format: date-time
          description: When the avatar joined the room (ISO 8601, UTC).
        expires_at:
          type: string
          format: date-time
          description: >-
            Latest end time: the session ends at this time if it is still
            running (`created_at` + `max_duration_seconds`).
        ended_at:
          type: string
          format: date-time
          nullable: true
          description: When the session ended; `null` while it is active.
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