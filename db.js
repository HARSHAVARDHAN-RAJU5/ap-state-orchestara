import "dotenv/config";
import pkg from "pg";
const { Pool } = pkg;

// credentials come from .env (see .env.example) — never hardcode them here
const pool = new Pool({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "ap_orchestara",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5433),
});

export default pool;
