> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Download content

> Download the rendered video. Returns the MP4 bytes (`variant=video`, the default). `404` until the video is `completed`.



## OpenAPI

````yaml /openapi.json get /v1/videos/{video_id}/content
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
  /v1/videos/{video_id}/content:
    get:
      tags:
        - Videos
      summary: Download content
      description: >-
        Download the rendered video. Returns the MP4 bytes (`variant=video`, the
        default). `404` until the video is `completed`.
      operationId: downloadVideoContent
      parameters:
        - name: video_id
          in: path
          required: true
          schema:
            type: string
          description: The video ID.
        - name: variant
          in: query
          required: false
          schema:
            type: string
            enum:
              - video
            default: video
          description: >-
            Which rendered asset to download. Only `video` (the MP4) is
            supported.
      responses:
        '200':
          description: The rendered MP4 bytes.
          content:
            video/mp4:
              schema:
                type: string
                format: binary
        '400':
          description: Unsupported `variant` (`invalid_variant`).
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
          description: No such video, or its content is not ready yet.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
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