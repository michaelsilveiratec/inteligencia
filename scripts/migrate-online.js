#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const defaultLocalUrl = "http://127.0.0.1:3333";
const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  if (!command || command === "help" || command === "--help" || command === "-h" || args.help || args.h) {
    printHelp();
    return;
  }

  if (command === "export") {
    await exportBackup({
      from: args.from || process.env.FROM_URL || defaultLocalUrl,
      out: args.out || process.env.BACKUP_FILE || defaultBackupPath(),
      token: args.token || process.env.ESTUDA_PLUS_ADMIN_TOKEN
    });
    return;
  }

  if (command === "restore") {
    requireYes();
    await restoreBackup({
      to: required(args.to || process.env.TO_URL, "--to"),
      file: required(args.file || process.env.BACKUP_FILE, "--file"),
      token: args.token || process.env.ESTUDA_PLUS_ADMIN_TOKEN
    });
    return;
  }

  if (command === "migrate") {
    requireYes();
    const file = args.out || process.env.BACKUP_FILE || defaultBackupPath();
    await exportBackup({
      from: args.from || process.env.FROM_URL || defaultLocalUrl,
      out: file,
      token: args.fromToken || args.token || process.env.ESTUDA_PLUS_ADMIN_TOKEN
    });
    await restoreBackup({
      to: required(args.to || process.env.TO_URL, "--to"),
      file,
      token: args.toToken || args.token || process.env.ESTUDA_PLUS_ADMIN_TOKEN
    });
    return;
  }

  if (command === "import-questions") {
    await importQuestions({
      to: required(args.to || process.env.TO_URL, "--to"),
      file: required(args.file || process.env.QUESTIONS_FILE, "--file"),
      token: args.token || process.env.ESTUDA_PLUS_ADMIN_TOKEN
    });
    return;
  }

  throw new Error(`Comando desconhecido: ${command}`);
}

async function exportBackup({ from, out, token }) {
  const backup = await requestJson(from, "/api/backup", { token });
  ensureParentDir(out);
  fs.writeFileSync(out, JSON.stringify(backup, null, 2), "utf8");
  console.log(`Backup exportado de ${from}`);
  console.log(`Arquivo: ${path.resolve(out)}`);
}

async function restoreBackup({ to, file, token }) {
  const backup = readJson(file);
  if (!backup?.tables) {
    throw new Error("O arquivo informado nao parece ser um backup completo do Estuda+.");
  }

  const result = await requestJson(to, "/api/backup/restore", {
    method: "POST",
    body: backup,
    token
  });
  console.log(`Backup restaurado em ${to}`);
  console.log(JSON.stringify(result, null, 2));
}

async function importQuestions({ to, file, token }) {
  const payload = readJson(file);
  const result = await requestJson(to, "/api/admin/questions/import", {
    method: "POST",
    body: payload,
    token
  });
  console.log(`Perguntas importadas em ${to}`);
  console.log(JSON.stringify(result, null, 2));
}

async function requestJson(baseUrl, apiPath, options = {}) {
  const url = `${normalizeBaseUrl(baseUrl)}${apiPath}`;
  const headers = {};
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || `Falha em ${url}: HTTP ${response.status}`);
  }
  return data;
}

function readJson(file) {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) throw new Error(`Arquivo nao encontrado: ${absolute}`);
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function ensureParentDir(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
}

function defaultBackupPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join("backups", `estuda-plus-backup-${stamp}.json`);
}

function requireYes() {
  if (!args.yes) {
    throw new Error("Esta acao substitui dados. Rode novamente com --yes para confirmar.");
  }
}

function required(value, name) {
  if (!value) throw new Error(`Informe ${name}.`);
  return value;
}

function printHelp() {
  console.log(`
Uso:
  node scripts/migrate-online.js export --from http://127.0.0.1:3333 --out backups/local.json
  node scripts/migrate-online.js restore --to https://seu-app.com --file backups/local.json --yes
  node scripts/migrate-online.js migrate --from http://127.0.0.1:3333 --to https://seu-app.com --yes
  node scripts/migrate-online.js import-questions --to https://seu-app.com --file minhas-questoes.json

Atalhos por variavel:
  FROM_URL, TO_URL, BACKUP_FILE, QUESTIONS_FILE, ESTUDA_PLUS_ADMIN_TOKEN
`.trim());
}
