import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const app = express();
const port = process.env.PORT || 3333;
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve("server", "data");
const dbPath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(dataDir, "estuda-plus.db");
const studentId = 1;
const backupTables = ["professores", "materias", "questoes", "alternativas", "usuarios", "tentativas", "respostas"];

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

app.use(cors());
app.use(express.json({ limit: "20mb" }));

db.exec(`
  CREATE TABLE IF NOT EXISTS professores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    email TEXT DEFAULT '',
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS materias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    professor_id INTEGER NOT NULL,
    nome TEXT NOT NULL,
    icone TEXT DEFAULT 'BookOpen',
    cor TEXT DEFAULT '#1677ff',
    descricao TEXT DEFAULT '',
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(professor_id, nome),
    FOREIGN KEY(professor_id) REFERENCES professores(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS questoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    materia_id INTEGER NOT NULL,
    enunciado TEXT NOT NULL,
    dificuldade TEXT DEFAULT 'Media',
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(materia_id) REFERENCES materias(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS alternativas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    questao_id INTEGER NOT NULL,
    texto TEXT NOT NULL,
    correta INTEGER NOT NULL DEFAULT 0,
    ordem INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(questao_id) REFERENCES questoes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT DEFAULT '',
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tentativas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    materia_id INTEGER NOT NULL,
    total_questoes INTEGER NOT NULL,
    acertos INTEGER NOT NULL,
    pontuacao INTEGER NOT NULL,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY(materia_id) REFERENCES materias(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS respostas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tentativa_id INTEGER NOT NULL,
    questao_id INTEGER NOT NULL,
    alternativa_id INTEGER,
    correta INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(tentativa_id) REFERENCES tentativas(id) ON DELETE CASCADE,
    FOREIGN KEY(questao_id) REFERENCES questoes(id) ON DELETE CASCADE,
    FOREIGN KEY(alternativa_id) REFERENCES alternativas(id) ON DELETE SET NULL
  );
`);

seedDatabase();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "Estuda+" });
});

app.get("/api/subjects", (_req, res) => {
  res.json(listSubjects());
});

app.patch("/api/subjects/:id", (req, res) => {
  const current = getSubject(req.params.id);
  if (!current) return res.status(404).json({ error: "Materia nao encontrada." });

  const professorName = cleanText(req.body.professor || current.professor);
  const subjectName = cleanText(req.body.name || req.body.nome || current.nome);
  const icon = cleanText(req.body.icon || req.body.icone || current.icone) || "BookOpen";
  const color = cleanText(req.body.color || req.body.cor || current.cor) || "#1677ff";

  if (!professorName) return res.status(400).json({ error: "Informe o professor." });
  if (!subjectName) return res.status(400).json({ error: "Informe a materia." });

  const professorId = getOrCreateProfessor(professorName);
  try {
    db.prepare(`
      UPDATE materias
      SET professor_id = ?, nome = ?, icone = ?, cor = ?
      WHERE id = ?
    `).run(professorId, subjectName, icon, color, current.id);
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return res.status(409).json({ error: "Ja existe essa materia para este professor." });
    }
    throw error;
  }

  res.json(getSubject(current.id));
});

app.delete("/api/subjects/:id", (req, res) => {
  const current = getSubject(req.params.id);
  if (!current) return res.status(404).json({ error: "Materia nao encontrada." });

  db.prepare("DELETE FROM materias WHERE id = ?").run(current.id);
  res.json({ ok: true });
});

app.get("/api/subjects/:id/quiz", (req, res) => {
  const subject = getSubject(req.params.id);
  if (!subject) return res.status(404).json({ error: "Materia nao encontrada." });

  const questions = db.prepare(`
    SELECT id, enunciado, dificuldade
    FROM questoes
    WHERE materia_id = ? AND ativo = 1
    ORDER BY id
  `).all(subject.id);

  res.json({
    subject,
    questions: questions.map((question) => ({
      ...question,
      alternatives: db.prepare(`
        SELECT id, texto, ordem
        FROM alternativas
        WHERE questao_id = ?
        ORDER BY ordem, id
      `).all(question.id)
    }))
  });
});

app.post("/api/subjects/:id/attempts", (req, res) => {
  const subject = getSubject(req.params.id);
  if (!subject) return res.status(404).json({ error: "Materia nao encontrada." });

  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  const questions = db.prepare(`
    SELECT id, enunciado
    FROM questoes
    WHERE materia_id = ? AND ativo = 1
    ORDER BY id
  `).all(subject.id);

  if (!questions.length) return res.status(400).json({ error: "Materia sem questoes." });

  const answerByQuestion = new Map(answers.map((answer) => [
    Number(answer.questionId),
    Number(answer.alternativeId)
  ]));

  let correctCount = 0;
  const details = questions.map((question) => {
    const selectedAlternativeId = answerByQuestion.get(question.id) || null;
    const correctAlternative = db.prepare(`
      SELECT id, texto
      FROM alternativas
      WHERE questao_id = ? AND correta = 1
      LIMIT 1
    `).get(question.id);
    const selectedAlternative = selectedAlternativeId
      ? db.prepare("SELECT id, texto FROM alternativas WHERE id = ?").get(selectedAlternativeId)
      : null;
    const correct = Boolean(selectedAlternativeId && correctAlternative?.id === selectedAlternativeId);
    if (correct) correctCount += 1;
    return {
      questionId: question.id,
      question: question.enunciado,
      selectedAlternativeId,
      selectedText: selectedAlternative?.texto || "",
      correctAlternativeId: correctAlternative?.id || null,
      correctText: correctAlternative?.texto || "",
      correct
    };
  });

  const score = Math.round((correctCount / questions.length) * 100);
  const attemptId = db.prepare(`
    INSERT INTO tentativas (usuario_id, materia_id, total_questoes, acertos, pontuacao)
    VALUES (?, ?, ?, ?, ?)
  `).run(studentId, subject.id, questions.length, correctCount, score).lastInsertRowid;

  const insertAnswer = db.prepare(`
    INSERT INTO respostas (tentativa_id, questao_id, alternativa_id, correta)
    VALUES (?, ?, ?, ?)
  `);
  for (const detail of details) {
    insertAnswer.run(attemptId, detail.questionId, detail.selectedAlternativeId, detail.correct ? 1 : 0);
  }

  res.status(201).json({
    attemptId,
    subject,
    score,
    correctCount,
    total: questions.length,
    details
  });
});

app.get("/api/history", (_req, res) => {
  const rows = db.prepare(`
    SELECT t.id, t.total_questoes, t.acertos, t.pontuacao, t.criado_em,
           m.nome as materia, p.nome as professor
    FROM tentativas t
    JOIN materias m ON m.id = t.materia_id
    JOIN professores p ON p.id = m.professor_id
    WHERE t.usuario_id = ?
    ORDER BY t.criado_em DESC
  `).all(studentId);
  res.json(rows);
});

app.get("/api/ranking", (_req, res) => {
  const rows = db.prepare(`
    SELECT m.nome as materia, p.nome as professor,
           COUNT(t.id) as tentativas,
           MAX(t.pontuacao) as melhor_pontuacao,
           ROUND(AVG(t.pontuacao)) as media
    FROM materias m
    JOIN professores p ON p.id = m.professor_id
    LEFT JOIN tentativas t ON t.materia_id = m.id AND t.usuario_id = ?
    WHERE m.ativo = 1
    GROUP BY m.id
    ORDER BY melhor_pontuacao DESC NULLS LAST, media DESC NULLS LAST, m.nome
  `).all(studentId);
  res.json(rows.map((row) => ({
    ...row,
    tentativas: Number(row.tentativas || 0),
    melhor_pontuacao: Number(row.melhor_pontuacao || 0),
    media: Number(row.media || 0)
  })));
});

app.get("/api/profile", (_req, res) => {
  const user = db.prepare("SELECT * FROM usuarios WHERE id = ?").get(studentId);
  const stats = db.prepare(`
    SELECT COUNT(*) as attempts,
           COALESCE(SUM(acertos), 0) as correct,
           COALESCE(SUM(total_questoes - acertos), 0) as wrong,
           COALESCE(ROUND(AVG(pontuacao)), 0) as average
    FROM tentativas
    WHERE usuario_id = ?
  `).get(studentId);
  res.json({ user, stats });
});

app.get("/api/backup", (_req, res) => {
  const tables = {};
  for (const table of backupTables) {
    tables[table] = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  }

  res.json({
    app: "Estuda+",
    version: 1,
    exportedAt: new Date().toISOString(),
    dbPath,
    tables
  });
});

app.post("/api/backup/restore", (req, res) => {
  const backup = req.body;
  if (!backup?.tables || typeof backup.tables !== "object") {
    return res.status(400).json({ error: "Backup invalido." });
  }

  for (const table of backupTables) {
    if (!Array.isArray(backup.tables[table])) {
      return res.status(400).json({ error: `Backup sem tabela ${table}.` });
    }
  }

  const restore = db.transaction(() => {
    db.pragma("foreign_keys = OFF");
    for (const table of backupTables.slice().reverse()) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN (?, ?, ?, ?, ?, ?, ?)").run(...backupTables);

    for (const table of backupTables) {
      for (const row of backup.tables[table]) {
        insertBackupRow(table, row);
      }
    }
    db.pragma("foreign_keys = ON");
  });

  restore();
  res.json({ ok: true, restoredAt: new Date().toISOString() });
});

app.post("/api/admin/questions/import", (req, res) => {
  const items = normalizeQuestionImport(req.body);
  if (!items.length) {
    return res.status(400).json({ error: "Arquivo sem perguntas validas." });
  }

  const imported = [];
  const importQuestions = db.transaction(() => {
    for (const item of items) {
      const professorName = cleanText(item.professor);
      const subjectName = cleanText(item.subject || item.materia);
      const statement = cleanText(item.statement || item.enunciado || item.pergunta);
      const alternatives = normalizeAlternatives(item);
      const correctIndex = normalizeCorrectIndex(item, alternatives);

      if (!professorName || !subjectName || !statement || alternatives.length < 2 || correctIndex < 0) {
        continue;
      }

      const professorId = getOrCreateProfessor(professorName);
      const subjectId = getOrCreateSubject(professorId, subjectName, item.icon || item.icone, item.color || item.cor);
      const questionId = db.prepare(`
        INSERT INTO questoes (materia_id, enunciado, dificuldade)
        VALUES (?, ?, ?)
      `).run(subjectId, statement, cleanText(item.difficulty || item.dificuldade) || "Media").lastInsertRowid;

      const insertAlternative = db.prepare(`
        INSERT INTO alternativas (questao_id, texto, correta, ordem)
        VALUES (?, ?, ?, ?)
      `);
      alternatives.forEach((alternative, index) => {
        insertAlternative.run(questionId, alternative.text, index === correctIndex ? 1 : 0, index + 1);
      });

      imported.push({ questionId, subjectId, subject: subjectName });
    }
  });

  importQuestions();
  if (!imported.length) {
    return res.status(400).json({ error: "Nenhuma pergunta valida foi encontrada." });
  }

  res.status(201).json({ ok: true, imported: imported.length, items: imported });
});

app.post("/api/admin/questions", (req, res) => {
  const professorName = cleanText(req.body.professor);
  const subjectName = cleanText(req.body.subject);
  const statement = cleanText(req.body.statement);
  const alternatives = Array.isArray(req.body.alternatives)
    ? req.body.alternatives.map(cleanText).filter(Boolean)
    : [];
  const correctIndex = Number(req.body.correctIndex);

  if (!professorName) return res.status(400).json({ error: "Informe o professor." });
  if (!subjectName) return res.status(400).json({ error: "Informe a materia." });
  if (!statement) return res.status(400).json({ error: "Informe o enunciado." });
  if (alternatives.length < 2) return res.status(400).json({ error: "Informe ao menos duas alternativas." });
  if (Number.isNaN(correctIndex) || correctIndex < 0 || correctIndex >= alternatives.length) {
    return res.status(400).json({ error: "Escolha a alternativa correta." });
  }

  const professorId = getOrCreateProfessor(professorName);
  const subjectId = getOrCreateSubject(professorId, subjectName, req.body.icon, req.body.color);
  const questionId = db.prepare(`
    INSERT INTO questoes (materia_id, enunciado, dificuldade)
    VALUES (?, ?, ?)
  `).run(subjectId, statement, cleanText(req.body.difficulty) || "Media").lastInsertRowid;

  const insertAlternative = db.prepare(`
    INSERT INTO alternativas (questao_id, texto, correta, ordem)
    VALUES (?, ?, ?, ?)
  `);
  alternatives.forEach((alternative, index) => {
    insertAlternative.run(questionId, alternative, index === correctIndex ? 1 : 0, index + 1);
  });

  res.status(201).json({
    ok: true,
    questionId,
    subject: getSubject(subjectId)
  });
});

app.listen(port, () => {
  console.log(`Estuda+ API em http://127.0.0.1:${port}`);
});

function listSubjects() {
  return db.prepare(`
    SELECT m.id, m.nome, m.icone, m.cor, m.descricao, p.nome as professor,
           COUNT(q.id) as total_questoes
    FROM materias m
    JOIN professores p ON p.id = m.professor_id
    LEFT JOIN questoes q ON q.materia_id = m.id AND q.ativo = 1
    WHERE m.ativo = 1
    GROUP BY m.id
    ORDER BY m.nome
  `).all();
}

function getSubject(id) {
  return db.prepare(`
    SELECT m.id, m.nome, m.icone, m.cor, m.descricao, p.nome as professor,
           COUNT(q.id) as total_questoes
    FROM materias m
    JOIN professores p ON p.id = m.professor_id
    LEFT JOIN questoes q ON q.materia_id = m.id AND q.ativo = 1
    WHERE m.id = ? AND m.ativo = 1
    GROUP BY m.id
  `).get(Number(id));
}

function getOrCreateProfessor(name) {
  const existing = db.prepare("SELECT id FROM professores WHERE nome = ?").get(name);
  if (existing) return existing.id;
  return db.prepare("INSERT INTO professores (nome) VALUES (?)").run(name).lastInsertRowid;
}

function getOrCreateSubject(professorId, name, icon = "BookOpen", color = "#1677ff") {
  const existing = db.prepare("SELECT id FROM materias WHERE professor_id = ? AND nome = ?").get(professorId, name);
  if (existing) return existing.id;
  return db.prepare(`
    INSERT INTO materias (professor_id, nome, icone, cor)
    VALUES (?, ?, ?, ?)
  `).run(professorId, name, cleanText(icon) || "BookOpen", cleanText(color) || "#1677ff").lastInsertRowid;
}

function insertBackupRow(table, row) {
  const columns = Object.keys(row || {});
  if (!columns.length) return;
  const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const values = columns.map((column) => row[column]);
  db.prepare(`INSERT INTO ${table} (${quotedColumns}) VALUES (${placeholders})`).run(...values);
}

function normalizeQuestionImport(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.questions)) return payload.questions;
  if (Array.isArray(payload?.questoes)) return payload.questoes;
  if (payload && typeof payload === "object" && !payload.tables) return [payload];
  return [];
}

function normalizeAlternatives(item) {
  const raw = item.alternatives || item.alternativas || item.respostas || [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((alternative) => {
      if (typeof alternative === "string") return { text: cleanText(alternative), correct: false };
      return {
        text: cleanText(alternative.text || alternative.texto || alternative.resposta),
        correct: Boolean(alternative.correct || alternative.correta)
      };
    })
    .filter((alternative) => alternative.text);
}

function normalizeCorrectIndex(item, alternatives) {
  const numeric = Number(item.correctIndex ?? item.indiceCorreto ?? item.corretaIndex);
  if (!Number.isNaN(numeric) && numeric >= 0 && numeric < alternatives.length) return numeric;

  const markedIndex = alternatives.findIndex((alternative) => alternative.correct);
  if (markedIndex >= 0) return markedIndex;

  const correctText = cleanText(item.correctAnswer || item.respostaCorreta || item.correta);
  if (correctText) {
    return alternatives.findIndex((alternative) => alternative.text === correctText);
  }

  return -1;
}

function cleanText(value) {
  return String(value || "").trim();
}

function seedDatabase() {
  const userCount = db.prepare("SELECT COUNT(*) as total FROM usuarios").get().total;
  if (!userCount) {
    db.prepare("INSERT INTO usuarios (id, nome, email) VALUES (?, ?, ?)").run(studentId, "Aluno Demo", "aluno@estuda.local");
  }

  const subjectCount = db.prepare("SELECT COUNT(*) as total FROM materias").get().total;
  if (subjectCount) return;

  const data = [
    {
      professor: "Prof. Helena",
      subject: "Matematica",
      icon: "Calculator",
      color: "#1677ff",
      questions: [
        {
          statement: "Qual e o resultado da expressao 2(3x + 4) - 5x?",
          alternatives: ["x + 8", "x + 3", "6x + 8", "6x - 8"],
          correctIndex: 0
        },
        {
          statement: "Qual e o valor de x na equacao 2x^2 - 4x - 6 = 0?",
          alternatives: ["x = -1 ou x = 3", "x = -2 ou x = 3", "x = 1 ou x = -3", "x = 2 ou x = -3"],
          correctIndex: 0
        },
        {
          statement: "Uma funcao do primeiro grau tem qual forma geral?",
          alternatives: ["ax + b", "ax^2 + bx + c", "a/x", "sqrt(x)"],
          correctIndex: 0
        }
      ]
    },
    {
      professor: "Prof. Newton",
      subject: "Fisica",
      icon: "Atom",
      color: "#20b26b",
      questions: [
        {
          statement: "Qual grandeza mede a variacao de velocidade no tempo?",
          alternatives: ["Forca", "Aceleracao", "Trabalho", "Energia"],
          correctIndex: 1
        },
        {
          statement: "A unidade de forca no SI e:",
          alternatives: ["Joule", "Newton", "Watt", "Pascal"],
          correctIndex: 1
        }
      ]
    },
    {
      professor: "Prof. Livia",
      subject: "Quimica",
      icon: "FlaskConical",
      color: "#9d45e8",
      questions: [
        {
          statement: "Qual partícula possui carga negativa?",
          alternatives: ["Proton", "Neutron", "Eletron", "Molecula"],
          correctIndex: 2
        },
        {
          statement: "O pH abaixo de 7 indica uma solucao:",
          alternatives: ["Acida", "Basica", "Neutra", "Metalica"],
          correctIndex: 0
        }
      ]
    },
    {
      professor: "Prof. Ana",
      subject: "Historia",
      icon: "Landmark",
      color: "#ff8a00",
      questions: [
        {
          statement: "Qual evento marcou a transicao do trabalho artesanal para o fabril?",
          alternatives: ["Renascimento", "Revolucao Industrial", "Iluminismo", "Absolutismo"],
          correctIndex: 1
        },
        {
          statement: "A Independencia do Brasil ocorreu em:",
          alternatives: ["1789", "1808", "1822", "1889"],
          correctIndex: 2
        }
      ]
    }
  ];

  for (const subject of data) {
    const professorId = getOrCreateProfessor(subject.professor);
    const subjectId = getOrCreateSubject(professorId, subject.subject, subject.icon, subject.color);
    for (const question of subject.questions) {
      const questionId = db.prepare(`
        INSERT INTO questoes (materia_id, enunciado, dificuldade)
        VALUES (?, ?, ?)
      `).run(subjectId, question.statement, "Media").lastInsertRowid;
      const insertAlternative = db.prepare(`
        INSERT INTO alternativas (questao_id, texto, correta, ordem)
        VALUES (?, ?, ?, ?)
      `);
      question.alternatives.forEach((alternative, index) => {
        insertAlternative.run(questionId, alternative, index === question.correctIndex ? 1 : 0, index + 1);
      });
    }
  }
}
