import os from "node:os";
import path from "node:path";

process.env.DATABASE_PATH ||= path.join(os.tmpdir(), "prepara-prova-ia.db");
process.env.UPLOAD_DIR ||= path.join(os.tmpdir(), "prepara-prova-uploads");
process.env.VERCEL ||= "1";

const { default: app } = await import("../server/index.js");

export default function handler(req, res) {
  return app(req, res);
}
