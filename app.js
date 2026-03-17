import express from "express";

import invoiceIntakeRoutes from "./modules/step1-intake/routes/invoiceIntake.js";
import exceptionReviewRoutes from "./routes/exceptionReviewRoutes.js";
import recoveryRoutes from "./routes/recovery.routes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import dashboardRoutes from "./routes/DashboardRoutes.js";


const app = express();

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use("/api/invoices/intake", invoiceIntakeRoutes);
app.use("/api/review", exceptionReviewRoutes);
app.use("/api/recovery", recoveryRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
