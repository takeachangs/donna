> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# List avatars

> The avatars this API key can start a session with: Boson's public presets plus any avatars owned by the key. Use an item's `avatar_id` in `POST /v1/avatar/sessions`.



## OpenAPI

````yaml /openapi.json get /v1/avatars
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
  /v1/avatars:
    get:
      tags:
        - Avatar Realtime
      summary: List avatars
      description: >-
        The avatars this API key can start a session with: Boson's public
        presets plus any avatars owned by the key. Use an item's `avatar_id` in
        `POST /v1/avatar/sessions`.
      operationId: listAvatars
      responses:
        '200':
          description: The avatar list.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AvatarList'
        '401':
          description: Missing or invalid API key.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '503':
          description: >-
            The avatar catalog is not available on this server
            (`not_configured`).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
    AvatarList:
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
            $ref: '#/components/schemas/Avatar'
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
    Avatar:
      type: object
      properties:
        avatar_id:
          type: string
          description: Pass this as `avatar_id` when creating a session.
          example: builtin_claire_v1
        object:
          type: string
          enum:
            - avatar
          default: avatar
        name:
          type: string
          example: Claire
        width:
          type: integer
          description: Reference image width in pixels.
        height:
          type: integer
          description: Reference image height in pixels.
        is_public:
          type: boolean
          description: >-
            `true` for a Boson preset, `false` for an avatar owned by this API
            key.
        created_at:
          type: string
          format: date-time
          nullable: true
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: 'Your Boson API key, sent as `Authorization: Bearer $BOSON_API_KEY`.'

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.