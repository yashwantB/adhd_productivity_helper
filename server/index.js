import "dotenv/config";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { createAssistantEngine } from "./assistantEngine.js";
import { createDb } from "./db.js";
import { createLlmClient } from "./llmClient.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const llm = createLlmClient(process.env);
const assistant = createAssistantEngine({ llm });
const db = createDb(process.env);

app.use(cors({ origin: clientOrigin }));
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    llmEnabled: llm.enabled,
    llmProvider: llm.provider,
    llmModel: llm.model,
    llmReasoningEffort: llm.reasoningEffort || null,
    databaseProvider: db.provider,
    databaseEnabled: db.enabled
  });
});

app.post("/api/auth/signup", async (request, response, next) => {
  try {
    const body = z.object({
      email: z.string().email(),
      name: z.string().min(1).max(80),
      password: z.string().min(6).max(128)
    }).parse(request.body);
    response.json({ user: await db.signup(body) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(6).max(128)
    }).parse(request.body);
    response.json({ user: await db.login(body) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/threads", async (request, response, next) => {
  try {
    const userId = z.string().min(1).parse(request.header("x-user-id"));
    response.json({ threads: await db.listThreads(userId) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/threads/:id", async (request, response, next) => {
  try {
    const userId = z.string().min(1).parse(request.header("x-user-id"));
    const body = z.object({
      id: z.string().min(1),
      title: z.string(),
      preview: z.string(),
      messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        at: z.number().optional(),
        mode: z.string().optional(),
        energy: z.string().optional()
      })),
      session: z.unknown().nullable().optional(),
      createdAt: z.string().optional()
    }).parse({ ...request.body, id: request.params.id });
    response.json({ thread: await db.upsertThread(userId, body) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/threads/:id", async (request, response, next) => {
  try {
    const userId = z.string().min(1).parse(request.header("x-user-id"));
    await db.deleteThread(userId, request.params.id);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/session", (_request, response) => {
  response.json({ session: assistant.snapshot() });
});

app.post("/api/message", async (request, response, next) => {
  try {
    const body = z.object({
      message: z.string(),
      mode: z.enum(["start", "shrink", "unstuck", "sprint", "body", "resume", "switch", "shutdown"]).optional(),
      energy: z.enum(["low", "medium", "high"]).optional()
    }).parse(request.body);
    response.json(await assistant.handleMessage(body.message, body.mode, body.energy));
  } catch (error) {
    next(error);
  }
});

app.post("/api/message/stream", async (request, response, next) => {
  try {
    const body = z.object({
      message: z.string(),
      mode: z.enum(["start", "shrink", "unstuck", "sprint", "body", "resume", "switch", "shutdown"]).optional(),
      energy: z.enum(["low", "medium", "high"]).optional()
    }).parse(request.body);

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    for await (const event of assistant.handleMessageStream(body.message, body.mode, body.energy)) {
      response.write(`event: ${event.type}\n`);
      response.write(`data: ${JSON.stringify(event.type === "delta" || event.type === "thinking" ? event.content : event.data)}\n\n`);
    }

    response.write("event: done\ndata: true\n\n");
    response.end();
  } catch (error) {
    if (response.headersSent) {
      response.write(`event: error\ndata: ${JSON.stringify(error.message || "Stream failed")}\n\n`);
      response.end();
      return;
    }
    next(error);
  }
});

app.post("/api/timeout", (request, response) => {
  const minutes = Number(request.body?.minutes || 3);
  response.json(assistant.handleTimeout(minutes));
});

app.post("/api/reset", (_request, response) => {
  response.json(assistant.reset());
});

app.use((error, _request, response, _next) => {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: "Invalid request", details: error.flatten() });
    return;
  }

  if (error.message === "Invalid email or password") {
    response.status(401).json({ error: error.message });
    return;
  }

  if (error.message === "Account already exists") {
    response.status(409).json({ error: error.message });
    return;
  }

  response.status(500).json({ error: error.message || "Server error" });
});

app.listen(port, () => {
  console.log(`Assistant API listening on http://localhost:${port}`);
});
