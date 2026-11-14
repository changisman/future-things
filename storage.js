// 작품 저장소: DATABASE_URL 이 있으면 Postgres(Neon 등), 없으면 작품/ 폴더
import fs from "node:fs/promises";
import path from "node:path";

const MIME = { svg: "image/svg+xml", png: "image/png" };

export async function createStorage({ galleryDir }) {
  return process.env.DATABASE_URL ? createDbStorage() : createFileStorage(galleryDir);
}

async function createFileStorage(galleryDir) {
  const galleryFile = path.join(galleryDir, "gallery.json");
  await fs.mkdir(galleryDir, { recursive: true });

  async function list() {
    try {
      return JSON.parse(await fs.readFile(galleryFile, "utf8"));
    } catch {
      return [];
    }
  }

  let writeQueue = Promise.resolve();

  return {
    kind: "작품/ 폴더",
    list,
    async save(item, data, ext) {
      await fs.writeFile(path.join(galleryDir, `${item.id}.${ext}`), data);
      writeQueue = writeQueue.then(async () => {
        const items = await list();
        items.unshift(item);
        await fs.writeFile(galleryFile, JSON.stringify(items, null, 2));
      });
      return writeQueue;
    },
    async getImage(file) {
      const ext = path.extname(file).slice(1);
      if (!MIME[ext] || file !== path.basename(file)) return null;
      try {
        return { mime: MIME[ext], data: await fs.readFile(path.join(galleryDir, file)) };
      } catch {
        return null;
      }
    },
  };
}

async function createDbStorage() {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL, // Neon 주소의 ?sslmode=require 로 보안 연결
    max: 5,
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artworks (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      object     TEXT NOT NULL,
      keep       TEXT NOT NULL,
      improve    TEXT NOT NULL,
      ext        TEXT NOT NULL,
      data       BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  return {
    kind: "데이터베이스",
    async list() {
      const { rows } = await pool.query(
        "SELECT id, name, object, keep, improve, ext, created_at FROM artworks ORDER BY created_at DESC LIMIT 500"
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        object: r.object,
        keep: r.keep,
        improve: r.improve,
        image: `/gallery-images/${r.id}.${r.ext}`,
        createdAt: r.created_at.toISOString(),
      }));
    },
    async save(item, data, ext) {
      await pool.query(
        "INSERT INTO artworks (id, name, object, keep, improve, ext, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [item.id, item.name, item.object, item.keep, item.improve, ext, data, item.createdAt]
      );
    },
    async getImage(file) {
      const ext = path.extname(file).slice(1);
      if (!MIME[ext]) return null;
      const { rows } = await pool.query("SELECT data FROM artworks WHERE id = $1 AND ext = $2", [
        path.basename(file, "." + ext),
        ext,
      ]);
      return rows[0] ? { mime: MIME[ext], data: rows[0].data } : null;
    },
  };
}
