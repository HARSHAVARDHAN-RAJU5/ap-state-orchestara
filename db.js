import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "ap_orchestara",
  password: "936158",
  port: 5433,
});

export default pool;
