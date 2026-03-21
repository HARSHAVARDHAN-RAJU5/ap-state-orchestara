import express from "express";
import dotenv from "dotenv";
dotenv.config();

import invoiceIntakeRoutes from "./modules/step1-intake/routes/invoiceIntake.js";
import exceptionReviewRoutes from "./routes/exceptionReviewRoutes.js";
import recoveryRoutes from "./routes/recovery.routes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import approvalRoutes from "./routes/ApprovalRoutes.js";

const app = express();

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use("/api/invoices/intake", invoiceIntakeRoutes);
app.use("/api/review", exceptionReviewRoutes);
app.use("/api/recovery", recoveryRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/approvals", approvalRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});