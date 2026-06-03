import fs from "node:fs";
import path from "node:path";

export function loadEnv(file = ".env") {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) return {};

  const loaded = {};
  const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;

    const [key, value] = parsed;
    loaded[key] = value;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return loaded;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const separator = normalized.indexOf("=");
  if (separator <= 0) return null;

  const key = normalized.slice(0, separator).trim();
  let value = normalized.slice(separator + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  return [key, value];
}
