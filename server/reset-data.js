import fs from "node:fs";
import path from "node:path";
import { db } from "./database.js";

const uploadDir = path.resolve("server", "uploads");

db.exec(`
  DELETE FROM study_sessions;
  DELETE FROM writing_submissions;
  DELETE FROM challenges;
  DELETE FROM topics;
  DELETE FROM subjects;
  DELETE FROM sqlite_sequence WHERE name IN ('study_sessions', 'writing_submissions', 'challenges', 'topics', 'subjects');
  VACUUM;
`);

if (fs.existsSync(uploadDir)) {
  for (const entry of fs.readdirSync(uploadDir)) {
    fs.rmSync(path.join(uploadDir, entry), { recursive: true, force: true });
  }
}

console.log("Dados zerados: materias, conteudos, desafios, escritas, simulados e uploads foram removidos.");
