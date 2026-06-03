#!/usr/bin/env node
import { createPostgresStore, createSqliteStore } from "../server/database.js";
import { loadEnv } from "../server/env.js";

loadEnv();

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  if (args.help || args.h) {
    printHelp();
    return;
  }

  if (!args.yes) {
    throw new Error("Esta acao substitui os dados do Postgres. Rode novamente com --yes para confirmar.");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL nao encontrada. Confirme se ela esta no arquivo .env.");
  }

  const sqlite = createSqliteStore();
  const postgres = await createPostgresStore({ databaseUrl });

  try {
    await sqlite.init();
    const backup = await sqlite.getBackup();
    await postgres.init();
    const result = await postgres.restoreBackup(backup);

    console.log("Migracao concluida para o Postgres.");
    console.log(JSON.stringify({
      ok: result.ok,
      restoredAt: result.restoredAt,
      source: backup.db,
      destination: "postgres",
      counts: Object.fromEntries(
        Object.entries(backup.tables).map(([table, rows]) => [table, rows.length])
      )
    }, null, 2));
  } finally {
    await sqlite.close();
    await postgres.close();
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (const item of argv) {
    if (item.startsWith("--")) parsed[item.slice(2)] = true;
  }
  return parsed;
}

function printHelp() {
  console.log(`
Uso:
  node scripts/migrate-to-postgres.js --yes

O script le DATABASE_URL do .env e copia o SQLite local para o Postgres.
`.trim());
}
