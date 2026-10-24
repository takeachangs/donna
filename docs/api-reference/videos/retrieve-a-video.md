> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Retrieve a video

> Retrieve the Video object (status / progress). Always JSON — the rendered MP4 is downloaded from `GET /v1/videos/{video_id}/content`.



## OpenAPI

````yaml /openapi.json get /v1/videos/{video_id}
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
  /v1/videos/{video_id}:
    get:
      tags:
        - Videos
      summary: Retrieve a video
      description: >-
        Retrieve the Video object (status / progress). Always JSON — the
        rendered MP4 is downloaded from `GET /v1/videos/{video_id}/content`.
      operationId: getVideo
      parameters:
        - name: video_id
          in: path
          required: true
          schema:
            type: string
          description: The video ID returned by `POST /v1/videos`.
      responses:
        '200':
          description: The Video object.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Video'
        '401':
          description: Missing or invalid API key.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '404':
          description: No video with that ID.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
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
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: 'Your Boson API key, sent as `Authorization: Bearer $BOSON_API_KEY`.'

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.