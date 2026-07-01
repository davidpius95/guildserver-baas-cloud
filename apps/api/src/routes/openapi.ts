import type { Request, Response } from "express";

/**
 * Hand-written OpenAPI 3.1 document for the /api/v1 REST facade (see rest-api.ts).
 * Kept in lock-step with the routes there. Served at /api/v1/openapi.json; a
 * Swagger UI is served at /api/v1/docs.
 */

const bearer = [{ bearerAuth: [] as string[] }];
const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const jsonBody = (properties: Record<string, unknown>, required?: string[]) => ({
  required: true,
  content: {
    "application/json": {
      schema: { type: "object", properties, ...(required ? { required } : {}) },
    },
  },
});
const ok = (description: string) => ({
  description,
  content: { "application/json": { schema: { type: "object" } } },
});

function buildDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "GuildServer BaaS Management API",
      version: "1.0.0",
      description:
        "REST facade over the BaaS platform. All endpoints (except auth register/login) require a Bearer JWT obtained from /auth/login.",
    },
    servers: [{ url: "/api/v1", description: "BaaS API" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    security: bearer,
    tags: [
      { name: "Auth" },
      { name: "Organizations" },
      { name: "Projects" },
      { name: "Backups" },
      { name: "Domains" },
      { name: "Metrics" },
      { name: "Branches" },
      { name: "Nodes" },
    ],
    paths: {
      "/auth/register": {
        post: {
          tags: ["Auth"],
          summary: "Register a new user (and optional organization)",
          security: [],
          requestBody: jsonBody(
            {
              email: { type: "string", format: "email" },
              password: { type: "string", minLength: 8 },
              name: { type: "string" },
              orgName: { type: "string" },
            },
            ["email", "password"],
          ),
          responses: { "200": ok("Created user + token") },
        },
      },
      "/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Log in and receive a JWT",
          security: [],
          requestBody: jsonBody(
            { email: { type: "string", format: "email" }, password: { type: "string" } },
            ["email", "password"],
          ),
          responses: { "200": ok("Token + user") },
        },
      },
      "/auth/me": {
        get: { tags: ["Auth"], summary: "Current user", responses: { "200": ok("User") } },
      },

      "/organizations": {
        get: { tags: ["Organizations"], summary: "List organizations", responses: { "200": ok("Organizations") } },
        post: {
          tags: ["Organizations"],
          summary: "Create organization",
          requestBody: jsonBody({ name: { type: "string" } }, ["name"]),
          responses: { "200": ok("Organization") },
        },
      },
      "/organizations/{id}": {
        parameters: [idParam],
        get: { tags: ["Organizations"], summary: "Get organization", responses: { "200": ok("Organization") } },
        patch: {
          tags: ["Organizations"],
          summary: "Rename organization",
          requestBody: jsonBody({ name: { type: "string" } }, ["name"]),
          responses: { "200": ok("Organization") },
        },
        delete: { tags: ["Organizations"], summary: "Delete organization", responses: { "200": ok("Deleted") } },
      },

      "/projects": {
        get: { tags: ["Projects"], summary: "List projects", responses: { "200": ok("Projects") } },
        post: {
          tags: ["Projects"],
          summary: "Create + provision a project",
          requestBody: jsonBody(
            {
              name: { type: "string" },
              organizationId: { type: "string", format: "uuid" },
              tier: { type: "string", enum: ["micro", "small", "medium", "large"], default: "small" },
              idleTimeoutMinutes: { type: "integer", minimum: 1 },
              analyticsEnabled: { type: "boolean", default: false },
              scalingMode: { type: "string", enum: ["manual", "auto"], default: "manual" },
            },
            ["name", "organizationId"],
          ),
          responses: { "200": ok("Provisioning project") },
        },
      },
      "/projects/{id}": {
        parameters: [idParam],
        get: { tags: ["Projects"], summary: "Get project", responses: { "200": ok("Project") } },
        patch: {
          tags: ["Projects"],
          summary: "Update project settings",
          requestBody: jsonBody({
            name: { type: "string" },
            idleTimeoutMinutes: { type: ["integer", "null"], minimum: 1 },
            scalingMode: { type: "string", enum: ["manual", "auto"] },
            backupEnabled: { type: "boolean" },
          }),
          responses: { "200": ok("Project") },
        },
        delete: { tags: ["Projects"], summary: "Delete project + tear down stack", responses: { "200": ok("Deleted") } },
      },
      "/projects/{id}/pause": {
        parameters: [idParam],
        post: { tags: ["Projects"], summary: "Pause project", responses: { "200": ok("Paused") } },
      },
      "/projects/{id}/resume": {
        parameters: [idParam],
        post: { tags: ["Projects"], summary: "Resume project", responses: { "200": ok("Resumed") } },
      },
      "/projects/{id}/wake": {
        parameters: [idParam],
        post: { tags: ["Projects"], summary: "Wake a paused project", responses: { "200": ok("Woken") } },
      },
      "/projects/{id}/connection": {
        parameters: [idParam],
        get: { tags: ["Projects"], summary: "Decrypted connection info + keys", responses: { "200": ok("Connection") } },
      },

      "/projects/{id}/backups": {
        parameters: [idParam],
        get: { tags: ["Backups"], summary: "List backups", responses: { "200": ok("Backups") } },
        post: { tags: ["Backups"], summary: "Create a manual backup", responses: { "200": ok("Backup enqueued") } },
      },
      "/backups/{backupId}/restore": {
        parameters: [{ ...idParam, name: "backupId" }],
        post: { tags: ["Backups"], summary: "Restore a backup (replaces current DB)", responses: { "200": ok("Restore enqueued") } },
      },

      "/projects/{id}/domains": {
        parameters: [idParam],
        get: { tags: ["Domains"], summary: "List custom domains", responses: { "200": ok("Domains") } },
        post: {
          tags: ["Domains"],
          summary: "Add a custom domain",
          requestBody: jsonBody({ hostname: { type: "string" } }, ["hostname"]),
          responses: { "200": ok("Domain + verification records") },
        },
      },
      "/domains/{id}/verify": {
        parameters: [idParam],
        post: { tags: ["Domains"], summary: "Re-check domain verification", responses: { "200": ok("Domain") } },
      },
      "/domains/{id}": {
        parameters: [idParam],
        delete: { tags: ["Domains"], summary: "Remove custom domain", responses: { "200": ok("Removed") } },
      },

      "/projects/{id}/metrics/latest": {
        parameters: [idParam],
        get: { tags: ["Metrics"], summary: "Latest metric sample", responses: { "200": ok("Metric") } },
      },
      "/projects/{id}/metrics": {
        parameters: [
          idParam,
          { name: "sinceMinutes", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 60 } },
        ],
        get: { tags: ["Metrics"], summary: "Metric samples over a time range", responses: { "200": ok("Metrics") } },
      },

      "/projects/{id}/branches": {
        parameters: [idParam],
        get: { tags: ["Branches"], summary: "List branches of a project", responses: { "200": ok("Branches") } },
        post: {
          tags: ["Branches"],
          summary: "Create a database branch",
          requestBody: jsonBody({ branchName: { type: "string" } }, ["branchName"]),
          responses: { "200": ok("Branch enqueued") },
        },
      },
      "/branches/{branchProjectId}/merge": {
        parameters: [{ ...idParam, name: "branchProjectId" }],
        post: { tags: ["Branches"], summary: "Merge a branch into its parent (pre-merge snapshot taken)", responses: { "200": ok("Merge enqueued") } },
      },
      "/branches/{branchProjectId}": {
        parameters: [{ ...idParam, name: "branchProjectId" }],
        delete: { tags: ["Branches"], summary: "Delete a branch", responses: { "200": ok("Delete enqueued") } },
      },

      "/nodes": {
        get: { tags: ["Nodes"], summary: "List compute nodes", responses: { "200": ok("Nodes") } },
      },
      "/nodes/{id}": {
        parameters: [idParam],
        get: { tags: ["Nodes"], summary: "Get node", responses: { "200": ok("Node") } },
      },
    },
  } as const;
}

let cached: ReturnType<typeof buildDocument> | null = null;
export function openApiDocument() {
  cached ??= buildDocument();
  return cached;
}

export function openApiJsonHandler(_req: Request, res: Response): void {
  res.json(openApiDocument());
}

const DOCS_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BaaS Management API — Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/api/v1/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
      });
    </script>
  </body>
</html>`;

export function docsHandler(_req: Request, res: Response): void {
  res.type("html").send(DOCS_HTML);
}
