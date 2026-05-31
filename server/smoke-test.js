import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 4333;
const baseUrl = `http://127.0.0.1:${port}`;
const testDbPath = path.join(os.tmpdir(), `estudafoco-smoke-${Date.now()}.db`);

const server = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), DATABASE_PATH: testDbPath, AI_PROFESSOR_ENABLED: "false" },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForServer();

  const health = await getJson("/api/health");
  assert(health.ok === true, "health endpoint should return ok");

  const subjects = await getJson("/api/subjects");
  assert(Array.isArray(subjects), "subjects endpoint should return an array");
  assert(subjects.length === 0 || Array.isArray(subjects[0].topics), "subjects should include topic arrays");

  const subject = await postJson("/api/subjects", {
    name: "Teste Local",
    exam_date: "2026-06-30",
    weight: 4
  });
  assert(subject.id, "subject creation should return an id");

  const examPlan = await postJson("/api/predictions", {
    professor: "Prof. Teste",
    subject: "Teste Local",
    exam_date: "2026-06-30",
    required_grade: 8.5
  });
  assert(examPlan.id, "exam plan creation should return an id");

  const form = new FormData();
  form.set("subject_id", subject.id);
  form.set("title", "Tema Teste");
  form.set("summary", "Resumo temporario para validar o sistema.");
  form.set("difficulty", "3");
  form.set("exam_weight", "4");
  form.set("previous_frequency", "2");
  form.set("class_emphasis", "3");
  form.set("student_confidence", "2");
  form.set("status", "Revisar");
  const topicResponse = await fetch(`${baseUrl}/api/topics`, {
    method: "POST",
    body: form
  });
  assert(topicResponse.ok, "topic creation should return HTTP 2xx");
  const topic = await topicResponse.json();
  assert(topic.id, "topic creation should return an id");

  const importForm = new FormData();
  importForm.set("subject_id", subject.id);
  importForm.set("main_theme", "Material Importado");
  importForm.set("content", "Scrum organiza o trabalho em sprints. Product Owner prioriza o backlog. Daily Scrum acompanha impedimentos e progresso.");
  const importResponse = await fetch(`${baseUrl}/api/import-material`, {
    method: "POST",
    body: importForm
  });
  assert(importResponse.ok, "material import should return HTTP 2xx");
  const imported = await importResponse.json();
  assert(imported.topics_created > 0, "material import should create topics");

  const cycle = await getJson("/api/study-cycle");
  assert(Array.isArray(cycle.today), "study cycle should include today list");

  const quizItems = await getJson("/api/quiz");
  assert(Array.isArray(quizItems), "quiz endpoint should return an array");
  assert(quizItems.every((item) => typeof item.question === "string"), "quiz items should include a question");

  const predictions = await getJson("/api/predictions");
  assert(predictions.length > 0, "predictions should not be empty");
  assert(predictions.every((item) => typeof item.subject === "string" && typeof item.professor === "string"), "predictions should include exam plan fields");

  const challenges = await getJson("/api/challenges");
  assert(challenges.length > 0, "topic creation should create challenges");
  const exactChallenge = challenges.find((item) => item.topic_title === "Tema Teste") || challenges[0];
  const answer = await postJson(`/api/challenges/${exactChallenge.id}/answer`, {
    answer: exactChallenge.reference_answer
  });
  assert(typeof answer.correct === "boolean", "challenge answer should return correctness");
  assert(Number.isInteger(answer.score), "challenge answer should return score");
  assert(answer.correct === true, "exact reference answer should validate as correct");
  assert(answer.score === 100, "exact reference answer should score 100");

  const passingChallenge = challenges.find((item) => item.id !== exactChallenge.id);
  assert(passingChallenge, "material import should create another challenge");
  const passingAnswer = await postJson(`/api/challenges/${passingChallenge.id}/answer`, {
    answer: "Scrum organiza trabalho em sprints com product owner backlog daily scrum impedimentos progresso equipe entrega planejamento exemplo pratico."
  });
  assert(passingAnswer.score > 50, "answer above 50 percent should score as passing");
  assert(passingAnswer.correct === true, "answer above 50 percent should validate as correct");
  assert(passingAnswer.status === "Concluido", "answer above 50 percent should mark challenge as completed");

  const report = await getJson("/api/report");
  assert(Number.isInteger(report.totalTopics), "report should include totalTopics");

  const page = await fetch(baseUrl);
  assert(page.ok, "local backend should serve the frontend");

  console.log("Smoke test passou: backend local, banco, APIs e frontend respondendo.");
} finally {
  server.kill();
  await delay(250);
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${testDbPath}${suffix}`, { force: true });
  }
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Servidor nao iniciou em ${baseUrl}.\n${output}`);
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert(response.ok, `${path} should return HTTP 2xx`);
  return response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  assert(response.ok, `${path} should return HTTP 2xx`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
