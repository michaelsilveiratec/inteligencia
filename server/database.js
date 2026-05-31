import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const defaultDataDir = path.resolve("server", "data");
const dbPath = process.env.DATABASE_PATH || path.join(process.env.DATA_DIR || defaultDataDir, "estudos.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    professor TEXT DEFAULT '',
    exam_date TEXT,
    weight INTEGER NOT NULL DEFAULT 3,
    difficulty INTEGER NOT NULL DEFAULT 3,
    desired_hours INTEGER NOT NULL DEFAULT 6,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS exam_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    professor TEXT NOT NULL,
    subject TEXT NOT NULL,
    exam_date TEXT NOT NULL,
    required_grade REAL NOT NULL DEFAULT 6.0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    summary TEXT DEFAULT '',
    difficulty INTEGER NOT NULL DEFAULT 3,
    exam_weight INTEGER NOT NULL DEFAULT 3,
    previous_frequency INTEGER NOT NULL DEFAULT 0,
    class_emphasis INTEGER NOT NULL DEFAULT 3,
    student_confidence INTEGER NOT NULL DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'Revisar',
    review_count INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    total_answers INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TEXT,
    next_review_at TEXT,
    pdf_path TEXT,
    subtopics TEXT DEFAULT '[]',
    videos TEXT DEFAULT '[]',
    links TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    questions TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    difficulty TEXT NOT NULL DEFAULT 'Medio',
    status TEXT NOT NULL DEFAULT 'Pendente',
    due_at TEXT,
    score INTEGER DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_answer TEXT DEFAULT '',
    feedback TEXT DEFAULT '',
    locked_until TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS writing_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER,
    prompt TEXT NOT NULL,
    answer TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    clarity INTEGER NOT NULL DEFAULT 0,
    coherence INTEGER NOT NULL DEFAULT 0,
    organization INTEGER NOT NULL DEFAULT 0,
    spelling INTEGER NOT NULL DEFAULT 0,
    depth INTEGER NOT NULL DEFAULT 0,
    mastery INTEGER NOT NULL DEFAULT 0,
    argumentation INTEGER NOT NULL DEFAULT 0,
    feedback TEXT DEFAULT '',
    rewrite_required INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS study_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL,
    minutes INTEGER NOT NULL DEFAULT 0,
    session_type TEXT NOT NULL DEFAULT 'Estudo',
    studied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS exam_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    subject_id INTEGER,
    subject_name TEXT NOT NULL,
    total_questions INTEGER NOT NULL DEFAULT 0,
    answered_questions INTEGER NOT NULL DEFAULT 0,
    correct_questions INTEGER NOT NULL DEFAULT 0,
    score_percent REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS exam_attempt_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_attempt_id INTEGER NOT NULL,
    topic_id INTEGER,
    question TEXT NOT NULL,
    expected_answer TEXT DEFAULT '',
    student_answer TEXT DEFAULT '',
    is_correct INTEGER NOT NULL DEFAULT 0,
    score REAL NOT NULL DEFAULT 0,
    feedback TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(exam_attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    titulo TEXT NOT NULL,
    pergunta TEXT NOT NULL,
    alternativa_a TEXT NOT NULL,
    alternativa_b TEXT NOT NULL,
    alternativa_c TEXT NOT NULL,
    alternativa_d TEXT NOT NULL,
    resposta_correta TEXT NOT NULL,
    nivel TEXT NOT NULL DEFAULT 'Medio',
    tema TEXT NOT NULL,
    subtema TEXT DEFAULT '',
    explicacao TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS quiz_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    question_id INTEGER NOT NULL,
    resposta TEXT NOT NULL,
    acertou INTEGER NOT NULL DEFAULT 0,
    nota REAL NOT NULL DEFAULT 0,
    tempo_resposta INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_mastery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    tema TEXT NOT NULL,
    dominio REAL NOT NULL DEFAULT 0,
    ultima_revisao TEXT,
    proxima_revisao TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, tema)
  );
`);

ensureColumn("subjects", "professor", "TEXT DEFAULT ''");
ensureColumn("subjects", "user_id", "TEXT NOT NULL DEFAULT 'default'");
ensureColumn("subjects", "difficulty", "INTEGER NOT NULL DEFAULT 3");
ensureColumn("subjects", "desired_hours", "INTEGER NOT NULL DEFAULT 6");
ensureColumn("exam_plans", "user_id", "TEXT NOT NULL DEFAULT 'default'");
ensureColumn("exam_attempts", "user_id", "TEXT NOT NULL DEFAULT 'default'");
ensureColumn("questions", "user_id", "TEXT NOT NULL DEFAULT 'default'");
ensureColumn("topics", "subtopics", "TEXT DEFAULT '[]'");
ensureColumn("topics", "videos", "TEXT DEFAULT '[]'");
ensureColumn("topics", "links", "TEXT DEFAULT '[]'");
ensureColumn("topics", "notes", "TEXT DEFAULT ''");
ensureColumn("challenges", "attempts", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("challenges", "last_answer", "TEXT DEFAULT ''");
ensureColumn("challenges", "feedback", "TEXT DEFAULT ''");
ensureColumn("challenges", "locked_until", "TEXT");

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function nextDate(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function generateQuestions(title, summary = "") {
  const base = summary || `Conceitos essenciais de ${title}.`;
  return [
    {
      question: `Qual é a ideia central de ${title}?`,
      answer: base
    },
    {
      question: `Como ${title} pode aparecer em uma questão discursiva?`,
      answer: `Explique o conceito, cite um exemplo e conecte com um problema real.`
    },
    {
      question: `Que detalhe costuma diferenciar uma resposta mediana de uma boa em ${title}?`,
      answer: `Usar termos técnicos corretos e justificar a aplicação no contexto da prova.`
    }
  ];
}
