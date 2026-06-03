import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createDataStore } from "./database.js";
import { loadEnv } from "./env.js";

const app = express();
loadEnv();
const port = process.env.PORT || 3333;
const store = await createDataStore();

await store.init();

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "Estuda+", db: store.name });
});

app.get("/api/subjects", asyncRoute(async (_req, res) => {
  res.json(await store.listSubjects());
}));

app.patch("/api/subjects/:id", asyncRoute(async (req, res) => {
  res.json(await store.updateSubject(req.params.id, req.body));
}));

app.delete("/api/subjects/:id", asyncRoute(async (req, res) => {
  res.json(await store.deleteSubject(req.params.id));
}));

app.get("/api/subjects/:id/quiz", asyncRoute(async (req, res) => {
  res.json(await store.getQuiz(req.params.id));
}));

app.post("/api/subjects/:id/attempts", asyncRoute(async (req, res) => {
  res.status(201).json(await store.createAttempt(req.params.id, req.body));
}));

app.get("/api/history", asyncRoute(async (_req, res) => {
  res.json(await store.getHistory());
}));

app.get("/api/ranking", asyncRoute(async (_req, res) => {
  res.json(await store.getRanking());
}));

app.get("/api/profile", asyncRoute(async (_req, res) => {
  res.json(await store.getProfile());
}));

app.get("/api/backup", asyncRoute(async (_req, res) => {
  res.json(await store.getBackup());
}));

app.post("/api/backup/restore", asyncRoute(async (req, res) => {
  res.json(await store.restoreBackup(req.body));
}));

app.post("/api/admin/questions/import", asyncRoute(async (req, res) => {
  res.status(201).json(await store.importQuestions(req.body));
}));

app.post("/api/admin/questions", asyncRoute(async (req, res) => {
  res.status(201).json(await store.createQuestion(req.body));
}));

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Rota de API nao encontrada." });
});

const distDir = path.resolve("dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.status ? error.message : "Erro interno do servidor."
  });
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Estuda+ em http://127.0.0.1:${port} usando ${store.name}`);
  });
}

export default app;

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
