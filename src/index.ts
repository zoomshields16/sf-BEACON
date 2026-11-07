import "dotenv/config";
import express from "express";
import { pool } from "./db.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true, db: true, mock: process.env.MOCK_CALLS === "true" });
  } catch (err) {
    res.status(500).json({ ok: false, db: false, error: (err as Error).message });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`SF-SafeNet API on http://localhost:${port}`));
