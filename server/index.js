import cors from "cors";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { db, generateQuestions, nextDate } from "./database.js";
import { generateProfessorQuestions, generateProfessorFeedback } from "./gemini-professor.js";

const app = express();
const port = process.env.PORT || 3333;
const uploadDir = process.env.UPLOAD_DIR || path.resolve("server", "uploads");
const distDir = path.resolve("dist");
fs.mkdirSync(uploadDir, { recursive: true });
loadLocalEnv();

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 15 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadDir));

ensureSingleChallengeForExistingTopics();
markPassingChallengesAsCompleted();

app.use((req, _res, next) => {
  req.userId = requestUserId(req);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "Prepara Prova IA" });
});

app.get("/api/dashboard", (req, res) => {
  markPassingChallengesAsCompleted();
  res.json(buildDashboard(req.userId));
});

app.get("/api/subjects", (req, res) => {
  const subjects = db.prepare("SELECT * FROM subjects WHERE user_id = ? ORDER BY created_at DESC").all(req.userId);
  const topics = db.prepare("SELECT * FROM topics ORDER BY created_at DESC").all();
  res.json(subjects.map((subject) => ({
    ...subject,
    topics: topics
      .filter((topic) => topic.subject_id === subject.id)
      .map((topic) => normalizeTopic({ ...topic, subject_weight: subject.weight }))
  })));
});

app.post("/api/subjects", (req, res) => {
  const { name, professor, exam_date, weight, difficulty, desired_hours } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nome da matéria é obrigatório." });

  const result = db.prepare(`
    INSERT INTO subjects (user_id, name, professor, exam_date, weight, difficulty, desired_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.userId,
    name.trim(),
    professor?.trim() || "",
    exam_date || null,
    numberInRange(weight, 1, 5, 3),
    numberInRange(difficulty, 1, 5, 3),
    numberInRange(desired_hours, 1, 40, 6)
  );

  res.status(201).json(db.prepare("SELECT * FROM subjects WHERE id = ?").get(result.lastInsertRowid));
});

app.patch("/api/subjects/:id", (req, res) => {
  const current = db.prepare("SELECT * FROM subjects WHERE id = ? AND user_id = ?").get(req.params.id, req.userId);
  if (!current) return res.status(404).json({ error: "Matéria não encontrada." });

  const next = { ...current, ...req.body };
  if (!String(next.name || "").trim()) return res.status(400).json({ error: "Nome da matéria é obrigatório." });

  db.prepare(`
    UPDATE subjects
    SET name = ?, professor = ?, exam_date = ?, weight = ?, difficulty = ?, desired_hours = ?
    WHERE id = ?
  `).run(
    String(next.name).trim(),
    String(next.professor || "").trim(),
    next.exam_date || null,
    numberInRange(next.weight, 1, 5, 3),
    numberInRange(next.difficulty, 1, 5, 3),
    numberInRange(next.desired_hours, 1, 40, 6),
    current.id
  );

  res.json(db.prepare("SELECT * FROM subjects WHERE id = ?").get(current.id));
});

app.delete("/api/subjects/:id", (req, res) => {
  const current = db.prepare("SELECT * FROM subjects WHERE id = ? AND user_id = ?").get(req.params.id, req.userId);
  if (!current) return res.status(404).json({ error: "Matéria não encontrada." });

  const topicIds = db.prepare("SELECT id FROM topics WHERE subject_id = ?").all(current.id).map((item) => item.id);
  const removeTopic = db.transaction((ids) => {
    for (const id of ids) deleteTopicById(id);
    db.prepare("DELETE FROM subjects WHERE id = ?").run(current.id);
  });
  removeTopic(topicIds);

  res.json({ ok: true });
});

app.post("/api/import-material", upload.single("material"), async (req, res) => {
  try {
    const body = req.body;
    const extracted = await extractMaterialText(req.file);
    const content = `${body.content || ""}\n${extracted}`.replace(/\s+/g, " ").trim();
    if (!content) return res.status(400).json({ error: "Envie um PDF, TXT ou cole o material escrito." });

    const subjectId = await resolveImportSubject(body, req.userId);
    const generated = generateTopicsFromMaterial(content, body.main_theme || "");
    const createdTopics = [];

    const insertTopic = db.prepare(`
      INSERT INTO topics (
        subject_id, title, summary, difficulty, exam_weight, previous_frequency,
        class_emphasis, student_confidence, status, next_review_at, pdf_path,
        subtopics, videos, links, notes, questions
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const topic of generated.topics) {
      const existing = findTopicByTitle(subjectId, topic.title);
      if (existing) {
        createdTopics.push({ id: existing.id, ...topic, skipped: true });
        continue;
      }

      const result = insertTopic.run(
        subjectId,
        topic.title,
        topic.summary,
        topic.difficulty,
        topic.examWeight,
        topic.frequency,
        topic.emphasis,
        2,
        "Revisar",
        nextDate(0),
        req.file ? `/uploads/${req.file.filename}` : null,
        JSON.stringify(topic.subtopics),
        "[]",
        JSON.stringify(splitLines(body.links)),
        topic.notes,
        JSON.stringify(topic.questions)
      );
      syncSingleChallengeForTopic(result.lastInsertRowid);
      createdTopics.push({ id: result.lastInsertRowid, ...topic });
    }

    res.status(201).json({
      subject_id: subjectId,
      topics_created: createdTopics.filter((topic) => !topic.skipped).length,
      topics: createdTopics,
      detected_keywords: generated.keywords
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao importar material." });
  }
});

app.post("/api/topics", upload.single("pdf"), (req, res) => {
  const body = req.body;
  const subjectId = Number(body.subject_id);
  const subject = db.prepare("SELECT * FROM subjects WHERE id = ? AND user_id = ?").get(subjectId, req.userId);
  if (!subject) return res.status(400).json({ error: "Matéria inválida." });
  if (!body.title?.trim()) return res.status(400).json({ error: "Tema é obrigatório." });
  if (findTopicByTitle(subjectId, body.title.trim())) return res.status(409).json({ error: "Este tema já existe nesta matéria." });

  const questions = buildSingleQuestion(body, body.title.trim(), body.summary);
  const answer = questions[0]?.answer || body.summary || "";

  const result = db.prepare(`
    INSERT INTO topics (
      subject_id, title, summary, difficulty, exam_weight, previous_frequency,
      class_emphasis, student_confidence, status, next_review_at, pdf_path,
      subtopics, videos, links, notes, questions
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    subjectId,
    body.title.trim(),
    answer,
    numberInRange(body.difficulty, 1, 5, 3),
    numberInRange(body.exam_weight, 1, 5, 3),
    numberInRange(body.previous_frequency, 0, 20, 0),
    numberInRange(body.class_emphasis, 1, 5, 3),
    numberInRange(body.student_confidence, 1, 5, 2),
    body.status || "Revisar",
    nextDate(0),
    req.file ? `/uploads/${req.file.filename}` : null,
    JSON.stringify(splitLines(body.subtopics)),
    JSON.stringify(splitLines(body.videos)),
    JSON.stringify(splitLines(body.links)),
    body.notes || "",
    JSON.stringify(questions)
  );

  syncSingleChallengeForTopic(result.lastInsertRowid);
  res.status(201).json(normalizeTopic(db.prepare("SELECT * FROM topics WHERE id = ?").get(result.lastInsertRowid)));
});

app.patch("/api/topics/:id", (req, res) => {
  const current = db.prepare(`
    SELECT topics.*
    FROM topics
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE topics.id = ? AND subjects.user_id = ?
  `).get(req.params.id, req.userId);
  if (!current) return res.status(404).json({ error: "Conteúdo não encontrado." });

  const next = { ...current, ...req.body };
  const subjectId = Number(next.subject_id);
  const subject = db.prepare("SELECT * FROM subjects WHERE id = ? AND user_id = ?").get(subjectId, req.userId);
  if (!subject) return res.status(400).json({ error: "Matéria inválida." });
  if (!String(next.title || "").trim()) return res.status(400).json({ error: "Tema é obrigatório." });

  const sameTitle = findTopicByTitle(subjectId, next.title);
  if (sameTitle && sameTitle.id !== current.id) return res.status(409).json({ error: "Este tema já existe nesta matéria." });

  const questions = buildSingleQuestion(next, String(next.title).trim(), next.summary || current.summary);
  const answer = questions[0]?.answer || next.summary || "";

  db.prepare(`
    UPDATE topics
    SET subject_id = ?, title = ?, summary = ?, difficulty = ?, exam_weight = ?,
        previous_frequency = ?, class_emphasis = ?, student_confidence = ?, status = ?,
        subtopics = ?, videos = ?, links = ?, notes = ?, questions = ?
    WHERE id = ?
  `).run(
    subjectId,
    String(next.title).trim(),
    answer,
    numberInRange(next.difficulty, 1, 5, 3),
    numberInRange(next.exam_weight, 1, 5, 3),
    numberInRange(next.previous_frequency, 0, 20, 0),
    numberInRange(next.class_emphasis, 1, 5, 3),
    numberInRange(next.student_confidence, 1, 5, 2),
    next.status || "Revisar",
    JSON.stringify(Array.isArray(next.subtopics) ? next.subtopics : splitLines(next.subtopics)),
    JSON.stringify(Array.isArray(next.videos) ? next.videos : splitLines(next.videos)),
    JSON.stringify(Array.isArray(next.links) ? next.links : splitLines(next.links)),
    next.notes || "",
    JSON.stringify(questions),
    current.id
  );

  syncSingleChallengeForTopic(current.id);
  res.json(normalizeTopic(db.prepare("SELECT * FROM topics WHERE id = ?").get(current.id)));
});

app.delete("/api/topics/:id", (req, res) => {
  const current = db.prepare(`
    SELECT topics.*
    FROM topics
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE topics.id = ? AND subjects.user_id = ?
  `).get(req.params.id, req.userId);
  if (!current) return res.status(404).json({ error: "Conteúdo não encontrado." });
  deleteTopicById(current.id);
  res.json({ ok: true });
});

app.patch("/api/topics/:id/review", (req, res) => {
  const topic = db.prepare(`
    SELECT topics.*
    FROM topics
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE topics.id = ? AND subjects.user_id = ?
  `).get(req.params.id, req.userId);
  if (!topic) return res.status(404).json({ error: "Tema nao encontrado." });

  const correct = Number(req.body.correct_answers ?? topic.correct_answers);
  const total = Number(req.body.total_answers ?? topic.total_answers);
  const confidence = numberInRange(req.body.student_confidence ?? topic.student_confidence, 1, 5, topic.student_confidence);
  const reviewCount = topic.review_count + 1;
  const nextOffset = confidence >= 4 ? 7 : confidence === 3 ? 3 : 1;
  const status = confidence >= 4 && reviewCount >= 2 ? "Dominado" : confidence <= 2 ? "Repetir" : "Revisar";

  db.prepare(`
    UPDATE topics
    SET review_count = ?, correct_answers = ?, total_answers = ?, student_confidence = ?,
        status = ?, last_reviewed_at = ?, next_review_at = ?
    WHERE id = ?
  `).run(reviewCount, correct, total, confidence, status, nextDate(0), nextDate(nextOffset), topic.id);

  res.json(normalizeTopic(db.prepare("SELECT * FROM topics WHERE id = ?").get(topic.id)));
});

app.post("/api/ai-helper", (req, res) => {
  const { content = "", title = "Tema" } = req.body;
  const clean = content.replace(/\s+/g, " ").trim();
  const sentences = clean.split(/[.!?]/).map((item) => item.trim()).filter(Boolean);
  const summary = sentences.slice(0, 4).join(". ") || `Resumo inicial para ${title}.`;
  const keywords = extractKeywords(clean || title);

  res.json({
    summary,
    questions: generateQuestions(title, summary).map((item, index) => ({
      ...item,
      question: index === 0 && keywords[0] ? `Explique ${keywords[0]} no contexto de ${title}.` : item.question
    })),
    predictionNotes: keywords.slice(0, 5).map((keyword) => ({
      theme: keyword,
      reason: "Termo recorrente no conteúdo colado."
    }))
  });
});

app.get("/api/quiz", (req, res) => {
  const topics = joinedTopics(req.userId);
  const items = buildQuizPlan(topics);
  res.json(items);
});

app.get("/api/study-cycle", (req, res) => {
  const topics = joinedTopics(req.userId);
  res.json({ today: buildQuizPlan(topics) });
});

app.post("/api/quiz/:topicId/submit", async (req, res) => {
  const topicId = Number(req.params.topicId);
  const topic = joinedTopics(req.userId).find((item) => item.id === topicId);
  if (!topic) return res.status(404).json({ error: "Tema não encontrado." });

  const answer = String(req.body.answer || "").trim();
  if (!answer) return res.status(400).json({ error: "Digite sua resposta antes de enviar." });

  const questionIndex = numberInRange(req.body.question_index, 0, 100, 0);
  const availableQuestions = Array.isArray(topic.questions) && topic.questions.length > 0
    ? topic.questions
    : buildSingleQuestion(topic, topic.title, topic.summary);
  const question = availableQuestions[questionIndex] || availableQuestions[0] || buildSingleQuestion(topic, topic.title, topic.summary)[0];
  const fakeChallenge = {
    prompt: question.question,
    questions: topic.questions,
    summary: topic.summary,
    topic_title: topic.title
  };

  const localEvaluation = evaluateChallengeAnswer(fakeChallenge, answer);
  const evaluation = await evaluateChallengeAnswerAsProfessor(fakeChallenge, answer, localEvaluation);
  const correct = evaluation.correct;
  const totalAnswers = (topic.total_answers || 0) + 1;
  const correctAnswers = (topic.correct_answers || 0) + (correct ? 1 : 0);
  const confidence = correct ? Math.min(5, topic.student_confidence + 1) : Math.max(1, topic.student_confidence - 1);
  const reviewCount = (topic.review_count || 0) + 1;
  const status = correct ? (confidence >= 4 && reviewCount >= 2 ? "Dominado" : "Revisar") : "Repetir";
  const nextOffset = correct ? (confidence >= 4 ? 7 : 3) : 1;

  db.prepare(`
    UPDATE topics
    SET correct_answers = ?, total_answers = ?, student_confidence = ?, status = ?, review_count = ?, last_reviewed_at = ?, next_review_at = ?
    WHERE id = ?
  `).run(correctAnswers, totalAnswers, confidence, status, reviewCount, nextDate(0), nextDate(nextOffset), topic.id);

  const challenges = db.prepare("SELECT * FROM challenges WHERE topic_id = ? AND status != 'Concluido'").all(topic.id);
  const updatedChallenges = [];
  for (const challenge of challenges) {
    const boost = correct ? Math.max(10, Math.round(evaluation.score / 10) + 5) : 0;
    const newScore = Math.min(100, (challenge.score || 0) + boost);
    const nextStatus = newScore > 50 ? "Concluido" : challenge.status;
    db.prepare("UPDATE challenges SET score = ?, status = ? WHERE id = ?").run(newScore, nextStatus, challenge.id);
    updatedChallenges.push({ id: challenge.id, score: newScore, status: nextStatus });
  }

  markPassingChallengesAsCompleted();

  res.json({
    topic_id: topic.id,
    topic_title: topic.title,
    question: question.question,
    correct_answer: question.answer,
    correct: evaluation.correct,
    score: evaluation.score,
    feedback: evaluation.feedback,
    level: evaluation.level,
    challengeUpdates: updatedChallenges
  });
});

app.get("/api/predictions", (req, res) => {
  const plans = db.prepare("SELECT * FROM exam_plans WHERE user_id = ? ORDER BY exam_date IS NOT NULL DESC, exam_date ASC, created_at DESC").all(req.userId);
  res.json(plans.map((plan) => ({
    id: plan.id,
    professor: plan.professor,
    subject: plan.subject,
    exam_date: plan.exam_date,
    required_grade: plan.required_grade
  })));
});

app.post("/api/predictions", (req, res) => {
  const professor = String(req.body.professor || "").trim();
  const subject = String(req.body.subject || "").trim();
  const exam_date = String(req.body.exam_date || "").trim();
  const required_grade = Number(req.body.required_grade);

  if (!professor) return res.status(400).json({ error: "Nome do professor é obrigatório." });
  if (!subject) return res.status(400).json({ error: "Matéria é obrigatória." });
  if (!exam_date) return res.status(400).json({ error: "Data da prova é obrigatória." });
  if (Number.isNaN(required_grade) || required_grade < 0 || required_grade > 10) {
    return res.status(400).json({ error: "Informe uma nota mínima entre 0 e 10." });
  }

  const result = db.prepare(`
    INSERT INTO exam_plans (user_id, professor, subject, exam_date, required_grade)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.userId, professor, subject, exam_date, required_grade);

  res.status(201).json(db.prepare("SELECT * FROM exam_plans WHERE id = ?").get(result.lastInsertRowid));
});

app.patch("/api/predictions/:id", (req, res) => {
  const plan = db.prepare("SELECT * FROM exam_plans WHERE id = ? AND user_id = ?").get(req.params.id, req.userId);
  if (!plan) return res.status(404).json({ error: "Prova não encontrada." });

  const professor = String(req.body.professor || plan.professor).trim();
  const subject = String(req.body.subject || plan.subject).trim();
  const exam_date = String(req.body.exam_date || plan.exam_date).trim();
  const required_grade = Number(req.body.required_grade ?? plan.required_grade);

  if (!professor) return res.status(400).json({ error: "Nome do professor é obrigatório." });
  if (!subject) return res.status(400).json({ error: "Matéria é obrigatória." });
  if (!exam_date) return res.status(400).json({ error: "Data da prova é obrigatória." });
  if (Number.isNaN(required_grade) || required_grade < 0 || required_grade > 10) {
    return res.status(400).json({ error: "Informe uma nota mínima entre 0 e 10." });
  }

  db.prepare(`
    UPDATE exam_plans
    SET professor = ?, subject = ?, exam_date = ?, required_grade = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(professor, subject, exam_date, required_grade, plan.id);

  res.json(db.prepare("SELECT * FROM exam_plans WHERE id = ?").get(plan.id));
});

app.delete("/api/predictions/:id", (req, res) => {
  const plan = db.prepare("SELECT * FROM exam_plans WHERE id = ? AND user_id = ?").get(req.params.id, req.userId);
  if (!plan) return res.status(404).json({ error: "Prova não encontrada." });
  db.prepare("DELETE FROM exam_plans WHERE id = ?").run(plan.id);
  res.json({ ok: true });
});

app.get("/api/ai-professor/status", (_req, res) => {
  const configured = isAiProfessorConfigured();
  res.json({
    configured,
    mode: configured ? "Professor IA" : "IA local",
    provider: configured ? professorProvider() : null,
    model: configured ? professorModel() : null
  });
});

app.post("/api/ai-professor/generate-questions", async (req, res) => {
  try {
    const { title, summary = "", subject = "", difficulty = "Medio" } = req.body;
    if (!title?.trim()) {
      return res.status(400).json({ error: "Título do tema é obrigatório" });
    }

    const questions = await generateProfessorQuestions(
      title.trim(),
      summary?.trim() || "",
      subject?.trim() || "",
      difficulty
    );

    res.json({ 
      success: true, 
      questions,
      provider: "gemini",
      model: professorModel()
    });
  } catch (error) {
    console.error("Erro ao gerar perguntas:", error);
    res.status(500).json({ 
      error: "Não foi possível gerar perguntas com a IA Professor",
      details: error.message
    });
  }
});

app.post("/api/ai-professor/evaluate", async (req, res) => {
  try {
    const { question, student_answer, correct_answer } = req.body;
    if (!question?.trim() || !student_answer?.trim() || !correct_answer?.trim()) {
      return res.status(400).json({ error: "Pergunta, resposta do aluno e resposta correta são obrigatórias" });
    }

    const feedback = await generateProfessorFeedback(
      question.trim(),
      student_answer.trim(),
      correct_answer.trim()
    );

    res.json({ 
      success: true, 
      feedback,
      provider: "gemini",
      model: professorModel()
    });
  } catch (error) {
    console.error("Erro ao avaliar resposta:", error);
    res.status(500).json({ 
      error: "Não foi possível avaliar a resposta",
      details: error.message
    });
  }
});

app.get("/api/challenges", (req, res) => {
  markPassingChallengesAsCompleted();
  const challenges = db.prepare(`
    SELECT challenges.*, topics.title as topic_title, topics.summary, topics.questions,
           subjects.name as subject_name
    FROM challenges
    JOIN topics ON topics.id = challenges.topic_id
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE subjects.user_id = ?
    ORDER BY subjects.name ASC, challenges.status ASC, challenges.created_at DESC
  `).all(req.userId);

  res.json(challenges.map((challenge) => ({
    ...challenge,
    reference_answer: referenceChallengeAnswer(challenge),
    questions: undefined,
    summary: undefined
  })));
});

app.get("/api/challenges/:id/quiz", (req, res) => {
  const challenge = db.prepare(`
    SELECT challenges.*, topics.title as topic_title, topics.summary, topics.questions,
           topics.id as topic_id, subjects.name as subject_name
    FROM challenges
    JOIN topics ON topics.id = challenges.topic_id
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE challenges.id = ?
      AND subjects.user_id = ?
  `).get(req.params.id, req.userId);

  if (!challenge) return res.status(404).json({ error: "Desafio não encontrado." });

  const questions = buildChallengeQuizQuestions(challenge);
  res.json(questions.map((item, index) => ({
    id: index,
    question: item.question,
    hint: item.hint || "Escolha a alternativa mais correta e consulte a explicação após responder.",
    options: item.options.map((option, optionIndex) => ({
      id: optionIndex,
      label: String.fromCharCode(65 + optionIndex),
      text: option.text
    })),
    topic_title: challenge.topic_title,
    subject_name: challenge.subject_name
  })));
});

app.post("/api/challenges/:id/quiz/answer", async (req, res) => {
  try {
    const challenge = db.prepare(`
      SELECT challenges.*, topics.title as topic_title, topics.summary, topics.questions,
             topics.id as topic_id, subjects.name as subject_name
      FROM challenges
      JOIN topics ON topics.id = challenges.topic_id
      JOIN subjects ON subjects.id = topics.subject_id
      WHERE challenges.id = ?
        AND subjects.user_id = ?
    `).get(req.params.id, req.userId);

    if (!challenge) return res.status(404).json({ error: "Desafio não encontrado." });

    const questionIndex = Number(req.body.questionIndex || 0);
    const selectedOption = Number(req.body.selectedOption);
    const quizQuestions = buildChallengeQuizQuestions(challenge);
    const currentQuestion = quizQuestions[questionIndex] || quizQuestions[0];

    if (!Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption >= currentQuestion.options.length) {
      return res.status(400).json({ error: "Selecione uma alternativa válida." });
    }

    const correct = selectedOption === currentQuestion.correctIndex;
    const correctAnswer = currentQuestion.options[currentQuestion.correctIndex].text;
    const explanation = currentQuestion.explanation || `A alternativa correta explica que ${challenge.topic_title} deve ser entendida como ${currentQuestion.question}.`;

    res.json({
      questionIndex,
      question: currentQuestion.question,
      selectedOption,
      correct,
      correct_answer: correctAnswer,
      explanation,
      correct_option: String.fromCharCode(65 + currentQuestion.correctIndex)
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Não foi possível corrigir a questão do quiz." });
  }
});

app.post("/api/challenges/generate", (req, res) => {
  const topicId = Number(req.body.topic_id);
  const topic = db.prepare(`
    SELECT topics.*
    FROM topics
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE topics.id = ? AND subjects.user_id = ?
  `).get(topicId, req.userId);
  if (!topic) return res.status(404).json({ error: "Tema nao encontrado." });
  syncSingleChallengeForTopic(topic.id);
  res.status(201).json({ ok: true });
});

app.patch("/api/challenges/:id/complete", (req, res) => {
  const score = numberInRange(req.body.score, 0, 100, 80);
  const challenge = db.prepare(`
    SELECT challenges.id
    FROM challenges
    JOIN topics ON topics.id = challenges.topic_id
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE challenges.id = ? AND subjects.user_id = ?
  `).get(req.params.id, req.userId);
  if (!challenge) return res.status(404).json({ error: "Desafio nao encontrado." });
  db.prepare("UPDATE challenges SET status = 'Concluido', score = ? WHERE id = ?").run(score, challenge.id);
  res.json(db.prepare("SELECT * FROM challenges WHERE id = ?").get(challenge.id));
});

app.patch("/api/challenges/:id", (req, res) => {
  const current = db.prepare(`
    SELECT challenges.*
    FROM challenges
    JOIN topics ON topics.id = challenges.topic_id
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE challenges.id = ? AND subjects.user_id = ?
  `).get(req.params.id, req.userId);
  if (!current) return res.status(404).json({ error: "Desafio nao encontrado." });

  const next = { ...current, ...req.body };
  if (!String(next.prompt || "").trim()) return res.status(400).json({ error: "Pergunta do desafio e obrigatoria." });

  const nextStatus = Number(current.score || 0) > 50 ? "Concluido" : String(next.status || "Pendente").trim();
  const nextLockedUntil = nextStatus === "Concluido" ? null : next.locked_until || null;

  db.prepare(`
    UPDATE challenges
    SET type = ?, prompt = ?, difficulty = ?, status = ?, due_at = ?, feedback = ?, locked_until = ?
    WHERE id = ?
  `).run(
    String(next.type || "Pergunta Aberta").trim(),
    String(next.prompt).trim(),
    String(next.difficulty || "Medio").trim(),
    nextStatus,
    next.due_at || null,
    next.feedback || "",
    nextLockedUntil,
    current.id
  );

  res.json(db.prepare("SELECT * FROM challenges WHERE id = ?").get(current.id));
});

app.delete("/api/challenges/:id", (req, res) => {
  const current = db.prepare(`
    SELECT challenges.id
    FROM challenges
    JOIN topics ON topics.id = challenges.topic_id
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE challenges.id = ? AND subjects.user_id = ?
  `).get(req.params.id, req.userId);
  if (!current) return res.status(404).json({ error: "Desafio nao encontrado." });
  db.prepare("DELETE FROM challenges WHERE id = ?").run(current.id);
  res.status(204).send();
});

app.post("/api/challenges/:id/answer", async (req, res) => {
  try {
  const challenge = db.prepare(`
    SELECT challenges.*, topics.title as topic_title, topics.summary, topics.subtopics,
           topics.notes, topics.questions, subjects.name as subject_name
    FROM challenges
    JOIN topics ON topics.id = challenges.topic_id
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE challenges.id = ?
      AND subjects.user_id = ?
  `).get(req.params.id, req.userId);
  if (!challenge) return res.status(404).json({ error: "Desafio não encontrado." });

  const now = new Date();
  if (challenge.locked_until && new Date(challenge.locked_until) > now) {
    return res.status(429).json({
      error: "Aguarde para tentar novamente.",
      lockedUntil: challenge.locked_until
    });
  }

  const answer = String(req.body.answer || "").trim();
  if (!answer) return res.status(400).json({ error: "Digite sua resposta antes de enviar." });

  const localEvaluation = evaluateChallengeAnswer(challenge, answer);
  const evaluation = await evaluateChallengeAnswerAsProfessor(challenge, answer, localEvaluation);
  const attempts = (challenge.attempts || 0) + 1;
  const lockedUntil = evaluation.correct ? null : new Date(Date.now() + 3 * 60 * 1000).toISOString();
  const status = evaluation.correct ? "Concluido" : "Pendente";

  db.prepare(`
    UPDATE challenges
    SET status = ?, score = ?, attempts = ?, last_answer = ?, feedback = ?, locked_until = ?
    WHERE id = ?
  `).run(status, evaluation.score, attempts, answer, evaluation.feedback, lockedUntil, challenge.id);

  if (evaluation.correct) {
    db.prepare(`
      UPDATE topics
      SET correct_answers = correct_answers + 1,
          total_answers = total_answers + 1,
          student_confidence = CASE WHEN student_confidence < 5 THEN student_confidence + 1 ELSE 5 END,
          status = CASE WHEN student_confidence >= 3 THEN 'Dominado' ELSE status END,
          last_reviewed_at = ?,
          next_review_at = ?
      WHERE id = ?
    `).run(nextDate(0), nextDate(7), challenge.topic_id);
  } else {
    db.prepare(`
      UPDATE topics
      SET total_answers = total_answers + 1,
          student_confidence = CASE WHEN student_confidence > 1 THEN student_confidence - 1 ELSE 1 END,
          status = 'Repetir',
          next_review_at = ?
      WHERE id = ?
    `).run(nextDate(1), challenge.topic_id);
  }

  res.json({
    ...evaluation,
    attempts,
    lockedUntil,
    status
  });
  } catch (error) {
    res.status(500).json({ error: error.message || "Não foi possível corrigir a resposta." });
  }
});

app.post("/api/study-sessions", (req, res) => {
  const topicId = Number(req.body.topic_id);
  const topic = db.prepare(`
    SELECT topics.*
    FROM topics
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE topics.id = ? AND subjects.user_id = ?
  `).get(topicId, req.userId);
  if (!topic) return res.status(404).json({ error: "Tema nao encontrado." });

  const minutes = numberInRange(req.body.minutes, 5, 240, 30);
  db.prepare("INSERT INTO study_sessions (topic_id, minutes, session_type) VALUES (?, ?, ?)").run(topicId, minutes, req.body.session_type || "Estudo");
  res.status(201).json({ ok: true, minutes });
});

app.get("/api/exam", (req, res) => {
  const count = numberInRange(req.query.count, 10, 100, 10);
  const topics = joinedTopics(req.userId);
  const questions = [];
  for (const topic of topics.sort((a, b) => predictionScore(b) - predictionScore(a))) {
    for (const item of topic.questions) {
      questions.push({
        topic_id: topic.id,
        topic: topic.title,
        subject: topic.subject_name,
        difficulty: topic.difficulty >= 4 ? "Dificil" : topic.difficulty === 3 ? "Medio" : "Facil",
        question: item.question,
        answer: item.answer
      });
      if (questions.length >= count) break;
    }
    if (questions.length >= count) break;
  }
  res.json({ count: questions.length, questions });
});

app.get("/api/report", (req, res) => {
  const topics = joinedTopics(req.userId);
  const sessions = db.prepare(`
    SELECT study_sessions.*
    FROM study_sessions
    JOIN topics ON topics.id = study_sessions.topic_id
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE subjects.user_id = ?
  `).all(req.userId);
  const total = topics.length || 1;
  const dominated = topics.filter((topic) => topic.status === "Dominado").length;
  const delayed = topics.filter(isDelayed).length;
  const accuracyPool = topics.filter((topic) => topic.total_answers > 0);
  const accuracy = accuracyPool.length
    ? Math.round(accuracyPool.reduce((sum, topic) => sum + topic.correct_answers / topic.total_answers, 0) / accuracyPool.length * 100)
    : 0;

  res.json({
    totalTopics: topics.length,
    dominated,
    delayed,
    reviewLoad: topics.reduce((sum, topic) => sum + urgencyScore(topic), 0),
    progress: Math.round((dominated / total) * 100),
    accuracy,
    totalMinutes: sessions.reduce((sum, session) => sum + session.minutes, 0),
    weakestTopics: topics
      .slice()
      .sort((a, b) => weaknessScore(b) - weaknessScore(a))
      .slice(0, 5)
      .map((topic) => ({ id: topic.id, title: topic.title, score: weaknessScore(topic), status: topic.status }))
  });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Rota da API não encontrada." });
});

app.use((error, _req, res, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Arquivo muito grande. Envie um material de até 15 MB." });
  }

  return res.status(500).json({ error: error?.message || "Erro interno do servidor." });
});

if (fs.existsSync(distDir)) {
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

if (process.env.VERCEL !== "1") {
  app.listen(port, () => {
    console.log(`Prepara Prova IA em http://localhost:${port}`);
  });
}

export default app;

function joinedTopics(userId) {
  return db.prepare(`
    SELECT topics.*, subjects.name as subject_name, subjects.weight as subject_weight
    FROM topics
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE subjects.user_id = ?
  `).all(userId).map(normalizeTopic);
}

function deleteTopicById(id) {
  db.prepare("DELETE FROM study_sessions WHERE topic_id = ?").run(id);
  db.prepare("DELETE FROM writing_submissions WHERE topic_id = ?").run(id);
  db.prepare("DELETE FROM challenges WHERE topic_id = ?").run(id);
  db.prepare("DELETE FROM topics WHERE id = ?").run(id);
}

function findTopicByTitle(subjectId, title) {
  const wanted = normalize(title);
  return db.prepare("SELECT id, title FROM topics WHERE subject_id = ?").all(subjectId)
    .find((topic) => normalize(topic.title) === wanted);
}

function normalizeTopic(topic) {
  return {
    ...topic,
    questions: safeJson(topic.questions, []),
    subtopics: safeJson(topic.subtopics, []),
    videos: safeJson(topic.videos, []),
    links: safeJson(topic.links, []),
    probability: predictionScore(topic),
    isDelayed: isDelayed(topic),
    suggestedMinutes: suggestedMinutes(topic)
  };
}

function buildDashboard(userId) {
  const subjects = db.prepare("SELECT * FROM subjects WHERE user_id = ?").all(userId);
  const topics = joinedTopics(userId);
  const sessions = db.prepare(`
    SELECT study_sessions.*
    FROM study_sessions
    JOIN topics ON topics.id = study_sessions.topic_id
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE subjects.user_id = ?
  `).all(userId);
  const challenges = db.prepare(`
    SELECT challenges.*
    FROM challenges
    JOIN topics ON topics.id = challenges.topic_id
    JOIN subjects ON subjects.id = topics.subject_id
    WHERE subjects.user_id = ?
  `).all(userId);
  const totalAnswers = topics.reduce((sum, topic) => sum + topic.total_answers, 0);
  const correctAnswers = topics.reduce((sum, topic) => sum + topic.correct_answers, 0);
  const totalMinutes = sessions.reduce((sum, session) => sum + session.minutes, 0);
  const dominated = topics.filter((topic) => topic.status === "Dominado").length;
  const risk = topics.filter((topic) => topic.student_confidence <= 2 || predictionScore(topic) >= 80).length;
  const pendingChallenges = challenges.filter((challenge) => challenge.status !== "Concluido").length;
  const accuracy = totalAnswers ? Math.round((correctAnswers / totalAnswers) * 100) : 0;
  const xp = totalMinutes * 2 + challenges.filter((item) => item.status === "Concluido").length * 50;

  return {
    totalMinutes,
    subjectCount: subjects.length,
    nextExams: subjects.filter((subject) => subject.exam_date).sort((a, b) => String(a.exam_date).localeCompare(String(b.exam_date))).slice(0, 5),
    dominated,
    risk,
    accuracy,
    ranking: Math.max(1, Math.floor(xp / 300) + 1),
    pendingChallenges,
    weeklyGoal: subjects.reduce((sum, subject) => sum + (subject.desired_hours || 0), 0),
    xp,
    level: Math.max(1, Math.floor(xp / 1000) + 1),
    achievements: achievements(xp, dominated, challenges),
    distribution: {
      dominated,
      review: topics.filter((topic) => topic.status === "Revisar" || topic.status === "Em progresso").length,
      risk,
      critical: topics.filter((topic) => topic.status === "Repetir").length
    }
  };
}

function achievements(xp, dominated, challenges) {
  return [
    { title: "Aluno Persistente", detail: "Estude por 7 dias", earned: xp >= 300 },
    { title: "Mestre da Revisao", detail: "Domine 5 temas", earned: dominated >= 5 },
    { title: "Treinador de Desafios", detail: "Conclua 3 desafios", earned: challenges.filter((item) => item.status === "Concluido").length >= 3 },
    { title: "Especialista em Simulados", detail: "Conclua 5 desafios", earned: challenges.filter((item) => item.status === "Concluido").length >= 5 }
  ];
}

function buildSingleQuestion(source, title, fallbackAnswer = "") {
  const existingQuestions = Array.isArray(source.questions)
    ? source.questions
    : safeJson(source.questions, []);
  const firstExisting = existingQuestions[0] || {};
  const question = String(source.question || firstExisting.question || source.prompt || `Explique ${title} com suas palavras.`).trim();
  const answer = String(source.answer || firstExisting.answer || fallbackAnswer || source.summary || "").trim();
  return [{ question, answer }];
}

function syncSingleChallengeForTopic(topicId) {
  const topic = db.prepare("SELECT id, title, summary, questions FROM topics WHERE id = ?").get(topicId);
  if (!topic) return;

  const [question] = buildSingleQuestion(topic, topic.title, topic.summary);
  const challenges = db.prepare("SELECT * FROM challenges WHERE topic_id = ? ORDER BY id ASC").all(topic.id);
  const keep = challenges[0];

  if (!keep) {
    db.prepare("INSERT INTO challenges (topic_id, type, prompt, difficulty, due_at) VALUES (?, ?, ?, ?, ?)")
      .run(topic.id, "Pergunta", question.question, "Medio", nextDate(1));
    return;
  }

  db.prepare("UPDATE challenges SET type = ?, prompt = ?, difficulty = ?, due_at = ? WHERE id = ?")
    .run("Pergunta", question.question, keep.difficulty || "Medio", keep.due_at || nextDate(1), keep.id);

  for (const extra of challenges.slice(1)) {
    db.prepare("DELETE FROM challenges WHERE id = ?").run(extra.id);
  }
}

function ensureSingleChallengeForExistingTopics() {
  const topics = db.prepare("SELECT id FROM topics").all();
  for (const topic of topics) {
    syncSingleChallengeForTopic(topic.id);
  }
}

function markPassingChallengesAsCompleted() {
  db.prepare(`
    UPDATE challenges
    SET status = 'Concluido',
        locked_until = NULL
    WHERE score > 50
      AND status != 'Concluido'
  `).run();
}

async function extractMaterialText(file) {
  if (!file) return "";
  const buffer = fs.readFileSync(file.path);
  const originalName = file.originalname.toLowerCase();
  const mime = file.mimetype || "";

  if (mime.includes("pdf") || originalName.endsWith(".pdf")) {
    const parsed = await pdfParse(buffer);
    return parsed.text || "";
  }

  if (mime.startsWith("text/") || /\.(txt|md|csv)$/i.test(originalName)) {
    return buffer.toString("utf8");
  }

  return buffer.toString("utf8");
}

function resolveImportSubject(body, userId) {
  const subjectId = Number(body.subject_id);
  const existing = subjectId ? db.prepare("SELECT id FROM subjects WHERE id = ? AND user_id = ?").get(subjectId, userId) : null;
  if (existing) return existing.id;

  const name = body.new_subject_name?.trim() || guessSubjectName(body.content || "") || "Matéria importada";
  const result = db.prepare(`
    INSERT INTO subjects (user_id, name, professor, exam_date, weight, difficulty, desired_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    name,
    body.professor?.trim() || "",
    body.exam_date || null,
    numberInRange(body.weight, 1, 5, 3),
    numberInRange(body.difficulty, 1, 5, 3),
    numberInRange(body.desired_hours, 1, 40, 6)
  );
  return result.lastInsertRowid;
}

function generateTopicsFromMaterial(content, mainTheme) {
  const clean = content.replace(/\s+/g, " ").trim();
  const keywords = extractKeywords(clean).slice(0, 10);
  const sentences = clean.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
  const headingCandidates = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && line.length <= 70)
    .filter((line) => !/[.!?]$/.test(line))
    .slice(0, 8);

  const titles = unique([
    mainTheme?.trim(),
    ...headingCandidates,
    ...keywords.slice(0, 6).map(titleCase)
  ]).filter(Boolean).slice(0, 6);

  const safeTitles = titles.length ? titles : ["Tema principal"];
  const topics = safeTitles.map((title, index) => {
    const related = sentences
      .filter((sentence) => normalize(sentence).includes(normalize(title).split(" ")[0] || ""))
      .slice(0, 4);
    const selected = related.length ? related : sentences.slice(index * 3, index * 3 + 4);
    const summary = selected.join(" ").slice(0, 700) || `Resumo inicial sobre ${title}.`;
    const subtopics = keywords
      .filter((keyword) => !normalize(title).includes(normalize(keyword)))
      .slice(index, index + 5)
      .map(titleCase);

    return {
      title,
      summary,
      subtopics,
      notes: `Importado automaticamente pela IA local em ${nextDate(0)}.`,
      difficulty: estimateDifficulty(summary),
      examWeight: index < 2 ? 4 : 3,
      frequency: keywordFrequency(clean, title),
      emphasis: index < 3 ? 4 : 3,
      questions: buildGeneratedQuestions(title, summary)
    };
  });

  return { topics, keywords };
}

function buildGeneratedQuestions(title, summary) {
  return [
    { question: `Explique ${title} com suas palavras.`, answer: summary },
    { question: `Crie um exemplo prático envolvendo ${title}.`, answer: "Use um caso real, descreva o problema e aplique o conceito." },
    { question: `Quais pontos de ${title} podem cair em prova?`, answer: "Definição, aplicação, diferenças e exemplos." },
    { question: `Verdadeiro ou falso: ${title} deve ser entendido apenas por memorização. Justifique.`, answer: "Falso. O ideal é compreender, aplicar e argumentar." }
  ];
}

function guessSubjectName(content) {
  const firstLine = String(content || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!firstLine) return "";
  return titleCase(firstLine.slice(0, 48));
}

function estimateDifficulty(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const longWords = words.filter((word) => word.length > 10).length;
  if (words.length > 90 || longWords > 12) return 4;
  if (words.length < 30) return 2;
  return 3;
}

function keywordFrequency(content, title) {
  const first = normalize(title).split(" ")[0];
  if (!first) return 1;
  const matches = normalize(content).match(new RegExp(`\\b${escapeRegExp(first)}\\b`, "g"));
  return Math.min(20, Math.max(1, matches?.length || 1));
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalize(item || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function evaluateChallengeAnswerAsProfessor(challenge, answer, localEvaluation) {
  if (localEvaluation.exactReferenceMatch) {
    return {
      ...localEvaluation,
      evaluator: "resposta-base",
      feedback: "Professor IA: resposta-base correta. Você atingiu 100% porque respondeu de acordo com o gabarito cadastrado."
    };
  }

  if (!isAiProfessorConfigured()) {
    return {
      ...localEvaluation,
      evaluator: "local"
    };
  }

  try {
    const questions = safeJson(challenge.questions, []);
    const payload = {
      materia: challenge.subject_name,
      tema: challenge.topic_title,
      pergunta: challenge.prompt,
      dificuldade: challenge.difficulty,
      respostaDoAluno: answer,
      respostaBase: referenceChallengeAnswer(challenge),
      resumoDoConteudo: challenge.summary,
      subtopicos: safeJson(challenge.subtopics, []),
      anotacoes: challenge.notes,
      questoesCadastradas: questions
    };

    const parsed = professorProvider() === "gemini"
      ? await callGeminiProfessor(payload)
      : await callOpenAiProfessor(payload);
    const score = numberInRange(parsed.score, 0, 100, localEvaluation.score);
    const correct = score > 50;
    const level = parsed.level || scoreLabel(score);

    return {
      correct,
      score,
      feedback: parsed.feedback || localEvaluation.feedback,
      level,
      guidance: parsed.guidance || localEvaluation.guidance,
      strengths: stringArray(parsed.strengths).slice(0, 4),
      improvements: stringArray(parsed.improvements).slice(0, 4),
      improvedAnswer: String(parsed.improvedAnswer || "").trim(),
      missingTerms: stringArray(parsed.missingTerms).slice(0, 6),
      matchedTerms: stringArray(parsed.matchedTerms).slice(0, 8),
      exactReferenceMatch: false,
      evaluator: "professor-ai",
      provider: professorProvider()
    };
  } catch (error) {
    return {
      ...localEvaluation,
      evaluator: "local",
      provider: professorProvider(),
      feedback: `${localEvaluation.feedback} Professor IA indisponível agora; usei a correção local como reserva.`
    };
  }
}

async function callOpenAiProfessor(payload) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: professorModel(),
      max_output_tokens: 900,
      input: [
        {
          role: "system",
          content: professorInstructions()
        },
        {
          role: "user",
          content: `Avalie este desafio e retorne JSON com as chaves: score inteiro de 0 a 100, feedback, level, guidance, strengths array, improvements array, missingTerms array, matchedTerms array, improvedAnswer. Dados: ${JSON.stringify(payload)}`
        }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Falha ao chamar Professor IA.");

  return parseJsonFromAiText(extractResponseText(data));
}

async function callGeminiProfessor(payload) {
  const model = encodeURIComponent(professorModel());
  const key = encodeURIComponent(process.env.GEMINI_API_KEY);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: professorInstructions() }]
      },
      contents: [{
        role: "user",
        parts: [{ text: `Avalie este desafio e retorne JSON com as chaves: score inteiro de 0 a 100, feedback, level, guidance, strengths array, improvements array, missingTerms array, matchedTerms array, improvedAnswer. Dados: ${JSON.stringify(payload)}` }]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 900,
        responseMimeType: "application/json"
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Falha ao chamar Gemini.");

  return parseJsonFromAiText(extractGeminiText(data));
}

function professorInstructions() {
  return [
    "Você é um Professor IA em português do Brasil.",
    "Corrija a resposta do aluno com postura de professor exigente, claro e encorajador.",
    "Use a resposta-base e o conteúdo como referência, mas aceite respostas corretas com palavras diferentes.",
    "Retorne apenas JSON valido, sem markdown."
  ].join(" ");
}

function evaluateChallengeAnswer(challenge, answer) {
  const subtopics = safeJson(challenge.subtopics, []);
  const questions = safeJson(challenge.questions, []);
  const referenceAnswers = challengeReferenceAnswers(challenge, questions);
  const source = [
    challenge.topic_title,
    challenge.summary,
    challenge.notes,
    ...subtopics,
    ...questions.flatMap((item) => [item.question, item.answer])
  ].join(" ");

  const answerTokens = importantTokens(answer);
  const sourceTokens = new Set(importantTokens(source));
  const promptTokens = new Set(importantTokens(`${challenge.prompt} ${challenge.topic_title}`));
  const matched = answerTokens.filter((token) => sourceTokens.has(token));
  const promptMatched = answerTokens.filter((token) => promptTokens.has(token));
  const uniqueMatched = new Set(matched);
  const hasExample = /exemplo|caso|pr[aá]tica|aplic|situa/i.test(answer);
  const hasExplanation = answerTokens.length >= 12;

  const coverage = answerTokens.length ? uniqueMatched.size / Math.min(answerTokens.length, 24) : 0;
  const promptCoverage = promptMatched.length ? Math.min(promptMatched.length / 3, 1) : 0;
  const rawScore = Math.round((coverage * 65 + promptCoverage * 15 + (hasExample ? 10 : 0) + (hasExplanation ? 10 : 0)));
  const exactReferenceMatch = referenceAnswers.some((reference) => normalize(reference) === normalize(answer));
  const score = exactReferenceMatch ? 100 : Math.max(0, Math.min(100, rawScore));
  const correct = exactReferenceMatch || score > 50;
  const level = exactReferenceMatch
    ? "Resposta-base correta"
    : score >= 80
      ? "Excelente"
      : score >= 60
        ? "Bom caminho"
        : score > 50
          ? "Quase lá"
          : "Precisa revisar";

  const missing = [...sourceTokens]
    .filter((token) => !answerTokens.includes(token))
    .slice(0, 5)
    .map(titleCase);

  const feedback = correct
    ? `IA local: ${level}. Você acertou com ${score}%. Respostas acima de 50% ficam concluídas e verdes; quando a resposta-base cadastrada é repetida corretamente, ela vale 100%.`
    : `IA local: ${level}. Você chegou a ${score}%, mas ainda não validou. Releia a resposta-base e tente incluir mais termos centrais${missing.length ? ` como: ${missing.join(", ")}` : ""}. Você poderá tentar novamente em 3 minutos.`;
  const guidance = correct
    ? "Continue nesse caminho: use conceito, explicacao propria e exemplo curto."
    : "Para melhorar, responda em frases completas, cite os conceitos principais da resposta-base e acrescente um exemplo.";

  return {
    correct,
    score,
    feedback,
    level,
    guidance,
    missingTerms: missing,
    matchedTerms: [...uniqueMatched].slice(0, 8).map(titleCase),
    exactReferenceMatch
  };
}

function referenceChallengeAnswer(challenge) {
  const questions = safeJson(challenge.questions, []);
  const matching = questions.find((item) => normalize(item.question) === normalize(challenge.prompt));
  if (matching?.answer) return matching.answer;

  const usefulAnswer = questions.find((item) => item.answer)?.answer;
  if (usefulAnswer) return usefulAnswer;

  return challenge.summary || `Revise o tema ${challenge.topic_title} e responda usando conceitos, exemplos e conclusao.`;
}

function challengeReferenceAnswers(challenge, questions = safeJson(challenge.questions, [])) {
  return unique([
    ...questions
      .filter((item) => normalize(item.question) === normalize(challenge.prompt))
      .map((item) => item.answer),
    ...questions.map((item) => item.answer),
    challenge.summary
  ].filter(Boolean));
}

function importantTokens(text) {
  const ignored = new Set([
    "para", "como", "com", "uma", "que", "por", "dos", "das", "nas", "nos", "seu", "sua",
    "aula", "sobre", "tema", "este", "esta", "isso", "esse", "essa", "mais", "muito",
    "tambem", "porque", "quando", "onde", "deve", "pode", "entre", "pela", "pelo",
    "aluno", "sistema", "conceito", "resposta", "explique"
  ]);
  return normalize(text)
    .split(" ")
    .filter((token) => token.length >= 4 && !ignored.has(token));
}

function numberInRange(value, min, max, fallback) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return fallback;
  }
}

function splitLines(value) {
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function predictionScore(topic) {
  const accuracyPenalty = topic.total_answers > 0 ? 1 - topic.correct_answers / topic.total_answers : 0.4;
  const frequency = Math.min(topic.previous_frequency, 12);
  const raw =
    25 +
    topic.exam_weight * 4.5 +
    (topic.subject_weight || 3) * 2 +
    frequency * 2.2 +
    topic.class_emphasis * 3.8 +
    topic.difficulty * 1.5 +
    accuracyPenalty * 10 -
    topic.review_count * 3 -
    topic.student_confidence * 3.5;
  return Math.max(15, Math.min(95, Math.round(raw)));
}

function predictionReason(topic) {
  const reasons = [];
  if (topic.previous_frequency >= 6) reasons.push("muito recorrente");
  if (topic.exam_weight >= 4) reasons.push("peso alto");
  if (topic.class_emphasis >= 4) reasons.push("enfase em aula");
  if (topic.student_confidence <= 2) reasons.push("baixa confianca");
  return reasons.join(", ") || "probabilidade moderada";
}

function buildCycle(topics) {
  const sorted = uniqueTopics(topics.slice().sort((a, b) => urgencyScore(b) - urgencyScore(a)));
  const today = sorted.slice(0, 4).map((topic) => ({ ...topic, when: "Hoje" }));
  const tomorrow = sorted.slice(4, 7).map((topic) => ({ ...topic, when: "Amanhã" }));
  const week = sorted.slice(0, 10).map((topic) => ({ ...topic, when: "Semana" }));
  const month = sorted.slice(0, 20).map((topic) => ({ ...topic, when: "Mês" }));
  const delayed = sorted.filter(isDelayed);
  const repeat = sorted.filter((topic) => topic.status === "Repetir" || topic.student_confidence <= 2).slice(0, 5);
  const dominated = sorted.filter((topic) => topic.status === "Dominado");
  return { today, tomorrow, week, month, delayed, repeat, dominated };
}

function buildChallengeQuizQuestions(challenge) {
  const topicQuestions = Array.isArray(challenge.questions)
    ? challenge.questions.map((item) => (typeof item === "string" ? { question: item, answer: item } : item))
    : [];
  const prepared = topicQuestions.length > 0 ? topicQuestions : generateQuestions(challenge.topic_title, challenge.summary);
  const quizItems = prepared.slice(0, 5);

  while (quizItems.length < 5) {
    const extra = generateQuestions(challenge.topic_title, challenge.summary)[quizItems.length] || {
      question: `Revisite o conteúdo de ${challenge.topic_title} e escolha a alternativa mais adequada.`,
      answer: challenge.summary || `Explique o que é ${challenge.topic_title} com exemplos.`
    };
    quizItems.push(extra);
  }

  return quizItems.map((item) => {
    const correctAnswer = item.answer || item.question;
    const options = makeMultipleChoiceOptions(correctAnswer, challenge.topic_title, challenge.summary);
    const correctIndex = options.findIndex((option) => normalize(option.text) === normalize(correctAnswer));
    return {
      question: item.question,
      options,
      explanation: item.hint || item.answer || challenge.summary || `A resposta correta descreve ${challenge.topic_title} em termos claros, com conceito e aplicação.`,
      correctIndex: correctIndex >= 0 ? correctIndex : 0
    };
  });
}

function makeMultipleChoiceOptions(correctAnswer, topicTitle, summary) {
  const distractors = [
    `Uma definição básica de ${topicTitle} sem aplicação prática ou exemplos.`,
    `Uma explicação geral sobre um tema relacionado, mas que não responde à pergunta feita.`,
    `Uma resposta superficial que descreve apenas partes do conteúdo sem conclusão clara.`,
    `Uma descrição de conceitos próximos, mas fora do foco da questão.`
  ].map((text) => ({ text }));

  const rawOptions = [{ text: correctAnswer }, ...distractors];
  const uniqueOptions = [];
  for (const option of rawOptions) {
    if (!uniqueOptions.some((item) => normalize(item.text) === normalize(option.text))) {
      uniqueOptions.push(option);
    }
  }

  const shuffled = uniqueOptions.slice(0, 4).sort(() => Math.random() - 0.5);
  while (shuffled.length < 4) {
    shuffled.push({ text: `A alternativa correta explica ${topicTitle} e seu uso na prática.` });
  }

  return shuffled;
}

function buildQuizPlan(topics) {
  const sorted = uniqueTopics(topics.slice().sort((a, b) => urgencyScore(b) - urgencyScore(a)));
  const items = [];
  for (const topic of sorted) {
    const questions = Array.isArray(topic.questions) && topic.questions.length > 0
      ? topic.questions
      : [];
    for (const [questionIndex, question] of questions.entries()) {
      const options = makeMultipleChoiceOptions(question.answer, topic.title, topic.summary);
      const correctIndex = options.findIndex((option) => normalize(option.text) === normalize(question.answer));
      items.push({
        id: `${topic.id}-${questionIndex}`,
        topic_id: topic.id,
        question_index: questionIndex,
        title: topic.title,
        subject_name: topic.subject_name,
        question: question.question,
        hint: topic.notes || topic.summary || "Responda com suas palavras e exemplos.",
        correct_answer: question.answer,
        correct_index: correctIndex >= 0 ? correctIndex : 0,
        options: options.map((option, index) => ({
          id: index,
          label: String.fromCharCode(65 + index),
          text: option.text
        })),
        status: topic.status
      });
      if (items.length >= 7) return items;
    }
  }
  return items;
}

function uniqueTopics(topics) {
  const seen = new Set();
  return topics.filter((topic) => {
    const summary = normalize(topic.summary || "");
    const title = normalize(topic.title || "");
    const contentKey = summary.length > 120 ? summary.slice(0, 220) : title;
    const key = `${topic.subject_id}:${contentKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function urgencyScore(topic) {
  const delayBoost = isDelayed(topic) ? 20 : 0;
  return predictionScore(topic) + delayBoost + topic.difficulty * 5 - topic.student_confidence * 4;
}

function weaknessScore(topic) {
  const accuracy = topic.total_answers > 0 ? topic.correct_answers / topic.total_answers : 0.5;
  return Math.round((1 - accuracy) * 45 + topic.difficulty * 8 + (6 - topic.student_confidence) * 6);
}

function suggestedMinutes(topic) {
  return Math.max(15, Math.min(55, Math.round((predictionScore(topic) / 3 + topic.difficulty * 6) / 5) * 5));
}

function isDelayed(topic) {
  if (!topic.next_review_at) return true;
  return topic.next_review_at < nextDate(0);
}

function extractKeywords(text) {
  const ignored = new Set(["para", "como", "com", "uma", "que", "por", "dos", "das", "nas", "nos", "seu", "sua", "aula", "sobre", "tema", "este", "esta"]);
  const counts = new Map();
  text.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]{4,}/g)?.forEach((word) => {
      if (!ignored.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
    });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadLocalEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    const name = key.trim();
    const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (name && process.env[name] === undefined) process.env[name] = value;
  }
}

function isAiProfessorConfigured() {
  if (process.env.AI_PROFESSOR_ENABLED === "false") return false;
  return professorProvider() === "gemini"
    ? Boolean(process.env.GEMINI_API_KEY?.trim())
    : Boolean(process.env.OPENAI_API_KEY?.trim());
}

function professorProvider() {
  const configured = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (configured === "gemini" || configured === "openai") return configured;
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  return "openai";
}

function professorModel() {
  return professorProvider() === "gemini"
    ? process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash"
    : process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const parts = [];
  for (const item of data?.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
      if (typeof content.output_text === "string") parts.push(content.output_text);
    }
  }
  return parts.join("\n");
}

function extractGeminiText(data) {
  return (data?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => part.text || "")
    .filter(Boolean)
    .join("\n");
}

function parseJsonFromAiText(text) {
  const clean = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch {
    return {};
  }
}

function stringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (!value) return [];
  return String(value).split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function requestUserId(req) {
  const fromHeader = String(req.headers["x-user-id"] || "").trim();
  const fromQuery = String(req.query?.user_id || "").trim();
  const fromBody = String(req.body?.user_id || "").trim();
  const raw = fromHeader || fromQuery || fromBody || "default";
  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@._-]/g, "_")
    .slice(0, 120);
  return normalized || "default";
}

function scoreLabel(score) {
  if (score >= 90) return "Excelente";
  if (score >= 75) return "Muito bom";
  if (score >= 60) return "Bom caminho";
  if (score > 50) return "Quase lá";
  return "Precisa revisar";
}
