> ## Documentation Index
> Fetch the complete documentation index at: https://docs.boson.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Create a client secret

> Mint a short-lived credential for browser and client-side Higgs Realtime connections.

***


## OpenAPI

````yaml openapi.json POST /v1/realtime/client_secrets
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
  /v1/realtime/client_secrets:
    post:
      tags:
        - Realtime
      summary: Create a client secret
      description: >-
        Create a short-lived ephemeral key for a browser, mobile app, or other
        client-side Higgs Realtime connection. Call this endpoint from a trusted
        server with a valid Boson API key, then pass the returned key to the
        client.
      operationId: createRealtimeClientSecret
      requestBody:
        required: false
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateRealtimeClientSecretRequest'
      responses:
        '200':
          description: A short-lived Realtime client secret.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RealtimeClientSecret'
        '400':
          description: Invalid request body, or ephemeral keys are not enabled.
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
        '429':
          description: >-
            Billing entitlement refused. The OpenAI-style upstream error body is
            passed through.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '500':
          description: Client-secret generation failed.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
    CreateRealtimeClientSecretRequest:
      type: object
      additionalProperties: false
      properties:
        expires_after:
          type: object
          additionalProperties: false
          properties:
            seconds:
              type: integer
              minimum: 10
              maximum: 7200
              default: 600
              description: Client-secret lifetime in seconds.
      example:
        expires_after:
          seconds: 300
    RealtimeClientSecret:
      type: object
      required:
        - object
        - value
        - expires_at
        - session
      properties:
        object:
          type: string
          enum:
            - realtime.client_secret
        value:
          type: string
          description: Ephemeral key beginning with `bai-eph-`.
          example: bai-eph-<hash>
        expires_at:
          type: integer
          description: Expiration time as Unix seconds.
          example: 1712345678
        session:
          type: object
          required:
            - id
            - object
          properties:
            id:
              type: string
              description: Realtime session identifier.
              example: sess_ab12cd34
            object:
              type: string
              enum:
                - realtime.session
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