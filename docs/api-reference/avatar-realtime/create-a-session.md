> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Create a session

> Start a realtime avatar session: the avatar joins the LiveKit room you name in `transport`, as the participant whose token you minted, and publishes lip-synced video together with the speech audio that `transport.publisher_identity` streams to it over a LiveKit data stream. The response is the session object with `status: "active"`; the avatar is already in the room. Release it with `DELETE /v1/avatar/sessions/{session_id}` when the conversation ends. Creation is not idempotent: if the response is lost, do not replay the request blindly; look for the avatar participant in the room instead.



## OpenAPI

````yaml /openapi.json post /v1/avatar/sessions
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
  /v1/avatar/sessions:
    post:
      tags:
        - Avatar Realtime
      summary: Create a session
      description: >-
        Start a realtime avatar session: the avatar joins the LiveKit room you
        name in `transport`, as the participant whose token you minted, and
        publishes lip-synced video together with the speech audio that
        `transport.publisher_identity` streams to it over a LiveKit data stream.
        The response is the session object with `status: "active"`; the avatar
        is already in the room. Release it with `DELETE
        /v1/avatar/sessions/{session_id}` when the conversation ends. Creation
        is not idempotent: if the response is lost, do not replay the request
        blindly; look for the avatar participant in the room instead.
      operationId: createAvatarSession
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateAvatarSessionRequest'
      responses:
        '201':
          description: The session is active and the avatar has joined the room.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AvatarSession'
        '400':
          description: >-
            Malformed body: a missing field (`missing_required_field`) or a
            value outside its bounds or an unknown field
            (`invalid_field_value`), e.g. a `transport.url` that does not start
            with `wss://`, `max_duration_seconds` over 14400, or an `output`
            side outside 64–2048.
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
        '403':
          description: The API key may not use the requested `model`.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '404':
          description: >-
            Unknown `model`, or one that does not serve realtime sessions
            (`model_not_found`); unknown `avatar_id` (`avatar_not_found`).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '422':
          description: >-
            Well-formed but not startable: `invalid_livekit_url` (a `wss://` URL
            without a host or with credentials, or a host that is not an
            approved LiveKit server; LiveKit Cloud project URLs are approved,
            self-hosted servers are not), `invalid_identity`
            (`participant_identity` equals `publisher_identity`),
            `invalid_duration` (`max_duration_seconds` over the account limit),
            or `unsupported_output` (the requested size is not supported).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '429':
          description: >-
            Rate limited (`type: rate_limit_error`, `code:
            rate_limit_exceeded`), billing refusal (`type: insufficient_quota`,
            not transient), or every avatar slot in use (`capacity_exhausted`,
            with a `Retry-After` header in seconds).
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
    CreateAvatarSessionRequest:
      type: object
      required:
        - avatar_id
        - transport
      properties:
        model:
          type: string
          default: higgs-avatar
          enum:
            - higgs-avatar
          description: >-
            Avatar model ID, the same ID as `POST /v1/videos` uses. Optional;
            defaults to `higgs-avatar`.
        avatar_id:
          type: string
          minLength: 1
          maxLength: 256
          description: >-
            The face to render: a preset or an avatar owned by this API key,
            from `GET /v1/avatars`.
          example: builtin_claire_v1
        transport:
          $ref: '#/components/schemas/LiveKitTransport'
        output:
          allOf:
            - $ref: '#/components/schemas/OutputSize'
          description: >-
            Rendered video size in pixels (portrait or square works best).
            Optional; defaults to 480x640. The reference image is center-cropped
            to this aspect ratio.
        max_duration_seconds:
          type: integer
          minimum: 1
          maximum: 14400
          description: >-
            Hard cap on the session length; the session ends and the avatar
            leaves the room when it is reached. Optional; defaults to the
            account limit (3600 s), which a larger value may not exceed
            (`invalid_duration`).
          example: 1800
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
    LiveKitTransport:
      type: object
      description: >-
        The LiveKit room the avatar joins. You own the room and mint the
        avatar's token with your LiveKit API key and secret.
      required:
        - url
        - room_name
        - participant_token
        - participant_identity
        - publisher_identity
      properties:
        type:
          type: string
          enum:
            - livekit
          default: livekit
          description: Realtime provider. `livekit` is the only value today.
        url:
          type: string
          maxLength: 2048
          description: Your LiveKit Cloud project URL, `wss://<project>.livekit.cloud`.
          example: wss://my-project.livekit.cloud
        room_name:
          type: string
          minLength: 1
          maxLength: 128
          description: >-
            Name of the room the avatar joins. LiveKit Cloud creates the room
            when its first participant joins, so it needs no setup.
        participant_token:
          type: string
          minLength: 1
          maxLength: 16384
          description: >-
            LiveKit access token for the avatar participant, minted by you.
            Grants: `roomJoin` for `room_name`, `canPublish` with camera and
            microphone sources, and `canPublishData`. Its identity must equal
            `participant_identity`, and its TTL must outlast the session
            (`max_duration_seconds` plus a margin). The API does not inspect the
            token; a token with the wrong identity or grants fails when the
            avatar joins the room. This value is never echoed back or logged.
        participant_identity:
          type: string
          minLength: 1
          maxLength: 128
          description: Identity the avatar joins as. Must differ from `publisher_identity`.
          example: boson-avatar-agent
        publisher_identity:
          type: string
          minLength: 1
          maxLength: 128
          description: >-
            Identity of the participant that streams the speech audio to the
            avatar (your voice agent). The avatar lip-syncs to this audio.
          example: agent-7f3a
        audio_source:
          type: string
          enum:
            - data_stream
          default: data_stream
          description: >-
            How the speech audio reaches the avatar. `data_stream`: the LiveKit
            Agents avatar audio protocol, a LiveKit byte stream of 16-bit PCM
            frames (24 kHz) from `publisher_identity` to `participant_identity`,
            as `DataStreamAudioOutput` in `livekit-agents` implements it,
            including its playback and clear-buffer RPCs. The avatar republishes
            this audio as its own audio track together with the video.
    OutputSize:
      type: object
      required:
        - width
        - height
      properties:
        width:
          type: integer
          minimum: 64
          maximum: 2048
          example: 480
        height:
          type: integer
          minimum: 64
          maximum: 2048
          example: 640
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: 'Your Boson API key, sent as `Authorization: Bearer $BOSON_API_KEY`.'

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.