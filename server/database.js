import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const studentId = 1;
const backupTables = ["professores", "materias", "questoes", "alternativas", "usuarios", "tentativas", "respostas"];
const backupColumns = {
  professores: ["id", "nome", "email", "criado_em"],
  materias: ["id", "professor_id", "nome", "icone", "cor", "descricao", "ativo", "criado_em"],
  questoes: ["id", "materia_id", "enunciado", "dificuldade", "ativo", "criado_em"],
  alternativas: ["id", "questao_id", "texto", "correta", "ordem"],
  usuarios: ["id", "nome", "email", "criado_em"],
  tentativas: ["id", "usuario_id", "materia_id", "total_questoes", "acertos", "pontuacao", "criado_em"],
  respostas: ["id", "tentativa_id", "questao_id", "alternativa_id", "correta"]
};

export async function createDataStore(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (databaseUrl) {
    return createPostgresStore({ ...options, databaseUrl });
  }
  return createSqliteStore(options);
}

export function createSqliteStore(options = {}) {
  return new SqliteStore(options);
}

export async function createPostgresStore(options = {}) {
  const { Pool } = await import("pg");
  return new PostgresStore(Pool, options);
}

class SqliteStore {
  constructor(options = {}) {
    const dataDir = options.dataDir
      ? path.resolve(options.dataDir)
      : process.env.DATA_DIR
        ? path.resolve(process.env.DATA_DIR)
        : path.resolve("server", "data");
    const databasePath = options.databasePath ?? process.env.DATABASE_PATH;
    this.dbPath = databasePath ? path.resolve(databasePath) : path.join(dataDir, "estuda-plus.db");
    this.name = "sqlite";
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  async init() {
    this.db.exec(sqliteSchema);
    this.seedDatabase();
  }

  async close() {
    this.db.close();
  }

  async listSubjects() {
    return this.db.prepare(`
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

  async getSubject(id) {
    return this.getSubjectSync(id);
  }

  getSubjectSync(id) {
    return this.db.prepare(`
      SELECT m.id, m.nome, m.icone, m.cor, m.descricao, p.nome as professor,
             COUNT(q.id) as total_questoes
      FROM materias m
      JOIN professores p ON p.id = m.professor_id
      LEFT JOIN questoes q ON q.materia_id = m.id AND q.ativo = 1
      WHERE m.id = ? AND m.ativo = 1
      GROUP BY m.id
    `).get(Number(id));
  }

  async updateSubject(id, body) {
    const current = this.getSubjectSync(id);
    if (!current) throw httpError("Materia nao encontrada.", 404);

    const professorName = cleanText(body.professor || current.professor);
    const subjectName = cleanText(body.name || body.nome || current.nome);
    const icon = cleanText(body.icon || body.icone || current.icone) || "BookOpen";
    const color = cleanText(body.color || body.cor || current.cor) || "#1677ff";

    if (!professorName) throw httpError("Informe o professor.");
    if (!subjectName) throw httpError("Informe a materia.");

    const professorId = this.getOrCreateProfessor(professorName);
    try {
      this.db.prepare(`
        UPDATE materias
        SET professor_id = ?, nome = ?, icone = ?, cor = ?
        WHERE id = ?
      `).run(professorId, subjectName, icon, color, current.id);
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE")) {
        throw httpError("Ja existe essa materia para este professor.", 409);
      }
      throw error;
    }

    return this.getSubjectSync(current.id);
  }

  async deleteSubject(id) {
    const current = this.getSubjectSync(id);
    if (!current) throw httpError("Materia nao encontrada.", 404);
    this.db.prepare("DELETE FROM materias WHERE id = ?").run(current.id);
    return { ok: true };
  }

  async getQuiz(id) {
    const subject = this.getSubjectSync(id);
    if (!subject) throw httpError("Materia nao encontrada.", 404);

    const questions = this.db.prepare(`
      SELECT id, enunciado, dificuldade
      FROM questoes
      WHERE materia_id = ? AND ativo = 1
      ORDER BY id
    `).all(subject.id);

    return {
      subject,
      questions: questions.map((question) => ({
        ...question,
        alternatives: this.db.prepare(`
          SELECT id, texto, ordem
          FROM alternativas
          WHERE questao_id = ?
          ORDER BY ordem, id
        `).all(question.id)
      }))
    };
  }

  async createAttempt(subjectId, body) {
    const subject = this.getSubjectSync(subjectId);
    if (!subject) throw httpError("Materia nao encontrada.", 404);

    const answers = Array.isArray(body.answers) ? body.answers : [];
    const questions = this.db.prepare(`
      SELECT id, enunciado
      FROM questoes
      WHERE materia_id = ? AND ativo = 1
      ORDER BY id
    `).all(subject.id);

    if (!questions.length) throw httpError("Materia sem questoes.");

    const answerByQuestion = new Map(answers.map((answer) => [
      Number(answer.questionId),
      cleanNumber(answer.alternativeId)
    ]));

    let correctCount = 0;
    const details = questions.map((question) => {
      const selectedAlternativeId = answerByQuestion.get(question.id) || null;
      const correctAlternative = this.db.prepare(`
        SELECT id, texto
        FROM alternativas
        WHERE questao_id = ? AND correta = 1
        LIMIT 1
      `).get(question.id);
      const selectedAlternative = selectedAlternativeId
        ? this.db.prepare("SELECT id, texto FROM alternativas WHERE id = ?").get(selectedAlternativeId)
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
    const attemptId = this.db.prepare(`
      INSERT INTO tentativas (usuario_id, materia_id, total_questoes, acertos, pontuacao)
      VALUES (?, ?, ?, ?, ?)
    `).run(studentId, subject.id, questions.length, correctCount, score).lastInsertRowid;

    const insertAnswer = this.db.prepare(`
      INSERT INTO respostas (tentativa_id, questao_id, alternativa_id, correta)
      VALUES (?, ?, ?, ?)
    `);
    for (const detail of details) {
      insertAnswer.run(attemptId, detail.questionId, detail.selectedAlternativeId, detail.correct ? 1 : 0);
    }

    return {
      attemptId,
      subject,
      score,
      correctCount,
      total: questions.length,
      details
    };
  }

  async getHistory() {
    return this.db.prepare(`
      SELECT t.id, t.total_questoes, t.acertos, t.pontuacao, t.criado_em,
             m.nome as materia, p.nome as professor
      FROM tentativas t
      JOIN materias m ON m.id = t.materia_id
      JOIN professores p ON p.id = m.professor_id
      WHERE t.usuario_id = ?
      ORDER BY t.criado_em DESC
    `).all(studentId);
  }

  async getRanking() {
    const rows = this.db.prepare(`
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
    return normalizeRanking(rows);
  }

  async getProfile() {
    const user = this.db.prepare("SELECT * FROM usuarios WHERE id = ?").get(studentId);
    const stats = this.db.prepare(`
      SELECT COUNT(*) as attempts,
             COALESCE(SUM(acertos), 0) as correct,
             COALESCE(SUM(total_questoes - acertos), 0) as wrong,
             COALESCE(ROUND(AVG(pontuacao)), 0) as average
      FROM tentativas
      WHERE usuario_id = ?
    `).get(studentId);
    return { user, stats };
  }

  async getBackup() {
    const tables = {};
    for (const table of backupTables) {
      tables[table] = this.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    }

    return {
      app: "Estuda+",
      version: 1,
      exportedAt: new Date().toISOString(),
      db: this.name,
      dbPath: this.dbPath,
      tables
    };
  }

  async restoreBackup(backup) {
    validateBackup(backup);
    const restore = this.db.transaction(() => {
      this.db.pragma("foreign_keys = OFF");
      for (const table of backupTables.slice().reverse()) {
        this.db.prepare(`DELETE FROM ${table}`).run();
      }
      this.db.prepare("DELETE FROM sqlite_sequence WHERE name IN (?, ?, ?, ?, ?, ?, ?)").run(...backupTables);

      for (const table of backupTables) {
        for (const row of backup.tables[table]) {
          this.insertBackupRow(table, row);
        }
      }
      this.db.pragma("foreign_keys = ON");
    });

    restore();
    return { ok: true, restoredAt: new Date().toISOString() };
  }

  async importQuestions(payload) {
    const items = normalizeQuestionImport(payload);
    if (!items.length) throw httpError("Arquivo sem perguntas validas.");

    const imported = [];
    const importQuestions = this.db.transaction(() => {
      for (const item of items) {
        const importedItem = this.insertQuestionFromImport(item);
        if (importedItem) imported.push(importedItem);
      }
    });

    importQuestions();
    if (!imported.length) throw httpError("Nenhuma pergunta valida foi encontrada.");
    return { ok: true, imported: imported.length, items: imported };
  }

  async createQuestion(body) {
    const professorName = cleanText(body.professor);
    const subjectName = cleanText(body.subject);
    const statement = cleanText(body.statement);
    const alternatives = Array.isArray(body.alternatives)
      ? body.alternatives.map(cleanText).filter(Boolean)
      : [];
    const correctIndex = Number(body.correctIndex);

    if (!professorName) throw httpError("Informe o professor.");
    if (!subjectName) throw httpError("Informe a materia.");
    if (!statement) throw httpError("Informe o enunciado.");
    if (alternatives.length < 2) throw httpError("Informe ao menos duas alternativas.");
    if (Number.isNaN(correctIndex) || correctIndex < 0 || correctIndex >= alternatives.length) {
      throw httpError("Escolha a alternativa correta.");
    }

    const professorId = this.getOrCreateProfessor(professorName);
    const subjectId = this.getOrCreateSubject(professorId, subjectName, body.icon, body.color);
    const questionId = this.db.prepare(`
      INSERT INTO questoes (materia_id, enunciado, dificuldade)
      VALUES (?, ?, ?)
    `).run(subjectId, statement, cleanText(body.difficulty) || "Media").lastInsertRowid;

    const insertAlternative = this.db.prepare(`
      INSERT INTO alternativas (questao_id, texto, correta, ordem)
      VALUES (?, ?, ?, ?)
    `);
    alternatives.forEach((alternative, index) => {
      insertAlternative.run(questionId, alternative, index === correctIndex ? 1 : 0, index + 1);
    });

    return {
      ok: true,
      questionId,
      subject: this.getSubjectSync(subjectId)
    };
  }

  insertQuestionFromImport(item) {
    const professorName = cleanText(item.professor);
    const subjectName = cleanText(item.subject || item.materia);
    const statement = cleanText(item.statement || item.enunciado || item.pergunta);
    const alternatives = normalizeAlternatives(item);
    const correctIndex = normalizeCorrectIndex(item, alternatives);

    if (!professorName || !subjectName || !statement || alternatives.length < 2 || correctIndex < 0) {
      return null;
    }

    const professorId = this.getOrCreateProfessor(professorName);
    const subjectId = this.getOrCreateSubject(professorId, subjectName, item.icon || item.icone, item.color || item.cor);
    const questionId = this.db.prepare(`
      INSERT INTO questoes (materia_id, enunciado, dificuldade)
      VALUES (?, ?, ?)
    `).run(subjectId, statement, cleanText(item.difficulty || item.dificuldade) || "Media").lastInsertRowid;

    const insertAlternative = this.db.prepare(`
      INSERT INTO alternativas (questao_id, texto, correta, ordem)
      VALUES (?, ?, ?, ?)
    `);
    alternatives.forEach((alternative, index) => {
      insertAlternative.run(questionId, alternative.text, index === correctIndex ? 1 : 0, index + 1);
    });

    return { questionId, subjectId, subject: subjectName };
  }

  insertBackupRow(table, row) {
    const columns = safeBackupColumns(table, row);
    if (!columns.length) return;
    const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const values = columns.map((column) => row[column]);
    this.db.prepare(`INSERT INTO ${table} (${quotedColumns}) VALUES (${placeholders})`).run(...values);
  }

  getOrCreateProfessor(name) {
    const existing = this.db.prepare("SELECT id FROM professores WHERE nome = ?").get(name);
    if (existing) return existing.id;
    return this.db.prepare("INSERT INTO professores (nome) VALUES (?)").run(name).lastInsertRowid;
  }

  getOrCreateSubject(professorId, name, icon = "BookOpen", color = "#1677ff") {
    const existing = this.db.prepare("SELECT id FROM materias WHERE professor_id = ? AND nome = ?").get(professorId, name);
    if (existing) return existing.id;
    return this.db.prepare(`
      INSERT INTO materias (professor_id, nome, icone, cor)
      VALUES (?, ?, ?, ?)
    `).run(professorId, name, cleanText(icon) || "BookOpen", cleanText(color) || "#1677ff").lastInsertRowid;
  }

  seedDatabase() {
    const userCount = this.db.prepare("SELECT COUNT(*) as total FROM usuarios").get().total;
    if (!userCount) {
      this.db.prepare("INSERT INTO usuarios (id, nome, email) VALUES (?, ?, ?)").run(studentId, "Aluno Demo", "aluno@estuda.local");
    }

    const subjectCount = this.db.prepare("SELECT COUNT(*) as total FROM materias").get().total;
    if (subjectCount) return;

    for (const subject of seedData) {
      const professorId = this.getOrCreateProfessor(subject.professor);
      const subjectId = this.getOrCreateSubject(professorId, subject.subject, subject.icon, subject.color);
      for (const question of subject.questions) {
        this.insertQuestionFromImport({
          professor: subject.professor,
          subject: subject.subject,
          statement: question.statement,
          alternatives: question.alternatives,
          correctIndex: question.correctIndex,
          icon: subject.icon,
          color: subject.color
        });
      }
    }
  }
}

class PostgresStore {
  constructor(Pool, options = {}) {
    this.databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
    const ssl = shouldUsePostgresSsl(this.databaseUrl) ? { rejectUnauthorized: false } : false;
    this.pool = new Pool({ connectionString: normalizePostgresConnectionString(this.databaseUrl), ssl });
    this.name = "postgres";
  }

  async init() {
    await this.pool.query(postgresSchema);
    await this.seedDatabase();
  }

  async close() {
    await this.pool.end();
  }

  async listSubjects() {
    const { rows } = await this.pool.query(`
      SELECT m.id, m.nome, m.icone, m.cor, m.descricao, p.nome as professor,
             COUNT(q.id)::int as total_questoes
      FROM materias m
      JOIN professores p ON p.id = m.professor_id
      LEFT JOIN questoes q ON q.materia_id = m.id AND q.ativo = 1
      WHERE m.ativo = 1
      GROUP BY m.id, p.nome
      ORDER BY m.nome
    `);
    return rows;
  }

  async getSubject(id, client = this.pool) {
    const { rows } = await client.query(`
      SELECT m.id, m.nome, m.icone, m.cor, m.descricao, p.nome as professor,
             COUNT(q.id)::int as total_questoes
      FROM materias m
      JOIN professores p ON p.id = m.professor_id
      LEFT JOIN questoes q ON q.materia_id = m.id AND q.ativo = 1
      WHERE m.id = $1 AND m.ativo = 1
      GROUP BY m.id, p.nome
    `, [Number(id)]);
    return rows[0];
  }

  async updateSubject(id, body) {
    const current = await this.getSubject(id);
    if (!current) throw httpError("Materia nao encontrada.", 404);

    const professorName = cleanText(body.professor || current.professor);
    const subjectName = cleanText(body.name || body.nome || current.nome);
    const icon = cleanText(body.icon || body.icone || current.icone) || "BookOpen";
    const color = cleanText(body.color || body.cor || current.cor) || "#1677ff";

    if (!professorName) throw httpError("Informe o professor.");
    if (!subjectName) throw httpError("Informe a materia.");

    const professorId = await this.getOrCreateProfessor(professorName);
    try {
      await this.pool.query(`
        UPDATE materias
        SET professor_id = $1, nome = $2, icone = $3, cor = $4
        WHERE id = $5
      `, [professorId, subjectName, icon, color, current.id]);
    } catch (error) {
      if (error.code === "23505") throw httpError("Ja existe essa materia para este professor.", 409);
      throw error;
    }

    return this.getSubject(current.id);
  }

  async deleteSubject(id) {
    const current = await this.getSubject(id);
    if (!current) throw httpError("Materia nao encontrada.", 404);
    await this.pool.query("DELETE FROM materias WHERE id = $1", [current.id]);
    return { ok: true };
  }

  async getQuiz(id) {
    const subject = await this.getSubject(id);
    if (!subject) throw httpError("Materia nao encontrada.", 404);

    const { rows: questions } = await this.pool.query(`
      SELECT id, enunciado, dificuldade
      FROM questoes
      WHERE materia_id = $1 AND ativo = 1
      ORDER BY id
    `, [subject.id]);

    for (const question of questions) {
      const { rows: alternatives } = await this.pool.query(`
        SELECT id, texto, ordem
        FROM alternativas
        WHERE questao_id = $1
        ORDER BY ordem, id
      `, [question.id]);
      question.alternatives = alternatives;
    }

    return { subject, questions };
  }

  async createAttempt(subjectId, body) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const subject = await this.getSubject(subjectId, client);
      if (!subject) throw httpError("Materia nao encontrada.", 404);

      const answers = Array.isArray(body.answers) ? body.answers : [];
      const { rows: questions } = await client.query(`
        SELECT id, enunciado
        FROM questoes
        WHERE materia_id = $1 AND ativo = 1
        ORDER BY id
      `, [subject.id]);

      if (!questions.length) throw httpError("Materia sem questoes.");

      const answerByQuestion = new Map(answers.map((answer) => [
        Number(answer.questionId),
        cleanNumber(answer.alternativeId)
      ]));

      let correctCount = 0;
      const details = [];
      for (const question of questions) {
        const selectedAlternativeId = answerByQuestion.get(question.id) || null;
        const { rows: correctRows } = await client.query(`
          SELECT id, texto
          FROM alternativas
          WHERE questao_id = $1 AND correta = 1
          LIMIT 1
        `, [question.id]);
        const correctAlternative = correctRows[0];
        const { rows: selectedRows } = selectedAlternativeId
          ? await client.query("SELECT id, texto FROM alternativas WHERE id = $1", [selectedAlternativeId])
          : { rows: [] };
        const selectedAlternative = selectedRows[0];
        const correct = Boolean(selectedAlternativeId && correctAlternative?.id === selectedAlternativeId);
        if (correct) correctCount += 1;
        details.push({
          questionId: question.id,
          question: question.enunciado,
          selectedAlternativeId,
          selectedText: selectedAlternative?.texto || "",
          correctAlternativeId: correctAlternative?.id || null,
          correctText: correctAlternative?.texto || "",
          correct
        });
      }

      const score = Math.round((correctCount / questions.length) * 100);
      const { rows: attemptRows } = await client.query(`
        INSERT INTO tentativas (usuario_id, materia_id, total_questoes, acertos, pontuacao)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [studentId, subject.id, questions.length, correctCount, score]);
      const attemptId = attemptRows[0].id;

      for (const detail of details) {
        await client.query(`
          INSERT INTO respostas (tentativa_id, questao_id, alternativa_id, correta)
          VALUES ($1, $2, $3, $4)
        `, [attemptId, detail.questionId, detail.selectedAlternativeId, detail.correct ? 1 : 0]);
      }

      await client.query("COMMIT");
      return {
        attemptId,
        subject,
        score,
        correctCount,
        total: questions.length,
        details
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getHistory() {
    const { rows } = await this.pool.query(`
      SELECT t.id, t.total_questoes, t.acertos, t.pontuacao, t.criado_em,
             m.nome as materia, p.nome as professor
      FROM tentativas t
      JOIN materias m ON m.id = t.materia_id
      JOIN professores p ON p.id = m.professor_id
      WHERE t.usuario_id = $1
      ORDER BY t.criado_em DESC
    `, [studentId]);
    return rows;
  }

  async getRanking() {
    const { rows } = await this.pool.query(`
      SELECT m.nome as materia, p.nome as professor,
             COUNT(t.id)::int as tentativas,
             MAX(t.pontuacao)::int as melhor_pontuacao,
             ROUND(AVG(t.pontuacao))::int as media
      FROM materias m
      JOIN professores p ON p.id = m.professor_id
      LEFT JOIN tentativas t ON t.materia_id = m.id AND t.usuario_id = $1
      WHERE m.ativo = 1
      GROUP BY m.id, p.nome
      ORDER BY melhor_pontuacao DESC NULLS LAST, media DESC NULLS LAST, m.nome
    `, [studentId]);
    return normalizeRanking(rows);
  }

  async getProfile() {
    const { rows: userRows } = await this.pool.query("SELECT * FROM usuarios WHERE id = $1", [studentId]);
    const { rows: statRows } = await this.pool.query(`
      SELECT COUNT(*)::int as attempts,
             COALESCE(SUM(acertos), 0)::int as correct,
             COALESCE(SUM(total_questoes - acertos), 0)::int as wrong,
             COALESCE(ROUND(AVG(pontuacao)), 0)::int as average
      FROM tentativas
      WHERE usuario_id = $1
    `, [studentId]);
    return { user: userRows[0], stats: statRows[0] };
  }

  async getBackup() {
    const tables = {};
    for (const table of backupTables) {
      const { rows } = await this.pool.query(`SELECT * FROM ${table} ORDER BY id`);
      tables[table] = rows;
    }

    return {
      app: "Estuda+",
      version: 1,
      exportedAt: new Date().toISOString(),
      db: this.name,
      tables
    };
  }

  async restoreBackup(backup) {
    validateBackup(backup);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const table of backupTables.slice().reverse()) {
        await client.query(`DELETE FROM ${table}`);
      }
      for (const table of backupTables) {
        for (const row of backup.tables[table]) {
          await this.insertBackupRow(client, table, row);
        }
      }
      for (const table of backupTables) {
        await resetPostgresSequence(client, table);
      }
      await client.query("COMMIT");
      return { ok: true, restoredAt: new Date().toISOString() };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async importQuestions(payload) {
    const items = normalizeQuestionImport(payload);
    if (!items.length) throw httpError("Arquivo sem perguntas validas.");

    const client = await this.pool.connect();
    const imported = [];
    try {
      await client.query("BEGIN");
      for (const item of items) {
        const importedItem = await this.insertQuestionFromImport(client, item);
        if (importedItem) imported.push(importedItem);
      }
      if (!imported.length) throw httpError("Nenhuma pergunta valida foi encontrada.");
      await client.query("COMMIT");
      return { ok: true, imported: imported.length, items: imported };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createQuestion(body) {
    const professorName = cleanText(body.professor);
    const subjectName = cleanText(body.subject);
    const statement = cleanText(body.statement);
    const alternatives = Array.isArray(body.alternatives)
      ? body.alternatives.map(cleanText).filter(Boolean)
      : [];
    const correctIndex = Number(body.correctIndex);

    if (!professorName) throw httpError("Informe o professor.");
    if (!subjectName) throw httpError("Informe a materia.");
    if (!statement) throw httpError("Informe o enunciado.");
    if (alternatives.length < 2) throw httpError("Informe ao menos duas alternativas.");
    if (Number.isNaN(correctIndex) || correctIndex < 0 || correctIndex >= alternatives.length) {
      throw httpError("Escolha a alternativa correta.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const professorId = await this.getOrCreateProfessor(professorName, client);
      const subjectId = await this.getOrCreateSubject(professorId, subjectName, body.icon, body.color, client);
      const { rows } = await client.query(`
        INSERT INTO questoes (materia_id, enunciado, dificuldade)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [subjectId, statement, cleanText(body.difficulty) || "Media"]);
      const questionId = rows[0].id;

      for (const [index, alternative] of alternatives.entries()) {
        await client.query(`
          INSERT INTO alternativas (questao_id, texto, correta, ordem)
          VALUES ($1, $2, $3, $4)
        `, [questionId, alternative, index === correctIndex ? 1 : 0, index + 1]);
      }

      await client.query("COMMIT");
      return {
        ok: true,
        questionId,
        subject: await this.getSubject(subjectId)
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async insertQuestionFromImport(client, item) {
    const professorName = cleanText(item.professor);
    const subjectName = cleanText(item.subject || item.materia);
    const statement = cleanText(item.statement || item.enunciado || item.pergunta);
    const alternatives = normalizeAlternatives(item);
    const correctIndex = normalizeCorrectIndex(item, alternatives);

    if (!professorName || !subjectName || !statement || alternatives.length < 2 || correctIndex < 0) {
      return null;
    }

    const professorId = await this.getOrCreateProfessor(professorName, client);
    const subjectId = await this.getOrCreateSubject(professorId, subjectName, item.icon || item.icone, item.color || item.cor, client);
    const { rows } = await client.query(`
      INSERT INTO questoes (materia_id, enunciado, dificuldade)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [subjectId, statement, cleanText(item.difficulty || item.dificuldade) || "Media"]);
    const questionId = rows[0].id;

    for (const [index, alternative] of alternatives.entries()) {
      await client.query(`
        INSERT INTO alternativas (questao_id, texto, correta, ordem)
        VALUES ($1, $2, $3, $4)
      `, [questionId, alternative.text, index === correctIndex ? 1 : 0, index + 1]);
    }

    return { questionId, subjectId, subject: subjectName };
  }

  async insertBackupRow(client, table, row) {
    const columns = safeBackupColumns(table, row);
    if (!columns.length) return;
    const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const values = columns.map((column) => row[column]);
    await client.query(`INSERT INTO ${table} (${quotedColumns}) VALUES (${placeholders})`, values);
  }

  async getOrCreateProfessor(name, client = this.pool) {
    const { rows } = await client.query(`
      INSERT INTO professores (nome)
      VALUES ($1)
      ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome
      RETURNING id
    `, [name]);
    return rows[0].id;
  }

  async getOrCreateSubject(professorId, name, icon = "BookOpen", color = "#1677ff", client = this.pool) {
    const { rows } = await client.query(`
      INSERT INTO materias (professor_id, nome, icone, cor)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (professor_id, nome) DO UPDATE SET nome = EXCLUDED.nome
      RETURNING id
    `, [professorId, name, cleanText(icon) || "BookOpen", cleanText(color) || "#1677ff"]);
    return rows[0].id;
  }

  async seedDatabase() {
    const { rows: userRows } = await this.pool.query("SELECT COUNT(*)::int as total FROM usuarios");
    if (!userRows[0].total) {
      await this.pool.query("INSERT INTO usuarios (id, nome, email) VALUES ($1, $2, $3)", [studentId, "Aluno Demo", "aluno@estuda.local"]);
      await resetPostgresSequence(this.pool, "usuarios");
    }

    const { rows: subjectRows } = await this.pool.query("SELECT COUNT(*)::int as total FROM materias");
    if (subjectRows[0].total) return;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const subject of seedData) {
        for (const question of subject.questions) {
          await this.insertQuestionFromImport(client, {
            professor: subject.professor,
            subject: subject.subject,
            statement: question.statement,
            alternatives: question.alternatives,
            correctIndex: question.correctIndex,
            icon: subject.icon,
            color: subject.color
          });
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
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

function validateBackup(backup) {
  if (!backup?.tables || typeof backup.tables !== "object") {
    throw httpError("Backup invalido.");
  }
  for (const table of backupTables) {
    if (!Array.isArray(backup.tables[table])) {
      throw httpError(`Backup sem tabela ${table}.`);
    }
  }
}

function safeBackupColumns(table, row) {
  const allowed = backupColumns[table] || [];
  return Object.keys(row || {}).filter((column) => allowed.includes(column));
}

function normalizeRanking(rows) {
  return rows.map((row) => ({
    ...row,
    tentativas: Number(row.tentativas || 0),
    melhor_pontuacao: Number(row.melhor_pontuacao || 0),
    media: Number(row.media || 0)
  }));
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function shouldUsePostgresSsl(databaseUrl = process.env.DATABASE_URL) {
  if (process.env.PGSSLMODE === "disable" || process.env.DATABASE_SSL === "false") return false;
  try {
    const url = new URL(databaseUrl);
    return !["localhost", "127.0.0.1"].includes(url.hostname);
  } catch (_error) {
    return true;
  }
}

function normalizePostgresConnectionString(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    const sslMode = url.searchParams.get("sslmode");
    if (["prefer", "require", "verify-ca"].includes(sslMode)) {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch (_error) {
    return databaseUrl;
  }
}

async function resetPostgresSequence(client, table) {
  const sequence = `${table}_id_seq`;
  await client.query(`SELECT setval($1, COALESCE(MAX(id), 1), COUNT(*) > 0) FROM ${table}`, [sequence]);
}

const sqliteSchema = `
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
`;

const postgresSchema = `
  CREATE TABLE IF NOT EXISTS professores (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL UNIQUE,
    email TEXT DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS materias (
    id SERIAL PRIMARY KEY,
    professor_id INTEGER NOT NULL REFERENCES professores(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    icone TEXT DEFAULT 'BookOpen',
    cor TEXT DEFAULT '#1677ff',
    descricao TEXT DEFAULT '',
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(professor_id, nome)
  );

  CREATE TABLE IF NOT EXISTS questoes (
    id SERIAL PRIMARY KEY,
    materia_id INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
    enunciado TEXT NOT NULL,
    dificuldade TEXT DEFAULT 'Media',
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS alternativas (
    id SERIAL PRIMARY KEY,
    questao_id INTEGER NOT NULL REFERENCES questoes(id) ON DELETE CASCADE,
    texto TEXT NOT NULL,
    correta INTEGER NOT NULL DEFAULT 0,
    ordem INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tentativas (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    materia_id INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
    total_questoes INTEGER NOT NULL,
    acertos INTEGER NOT NULL,
    pontuacao INTEGER NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS respostas (
    id SERIAL PRIMARY KEY,
    tentativa_id INTEGER NOT NULL REFERENCES tentativas(id) ON DELETE CASCADE,
    questao_id INTEGER NOT NULL REFERENCES questoes(id) ON DELETE CASCADE,
    alternativa_id INTEGER REFERENCES alternativas(id) ON DELETE SET NULL,
    correta INTEGER NOT NULL DEFAULT 0
  );
`;

const seedData = [
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
        statement: "Qual particula possui carga negativa?",
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
