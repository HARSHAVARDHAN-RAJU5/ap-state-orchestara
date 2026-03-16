import express from "express";

import invoiceIntakeRoutes from "./modules/step1-intake/routes/invoiceIntake.js";
import exceptionReviewRoutes from "./routes/exceptionReviewRoutes.js";


const app = express();

app.use(express.json());

app.use("/api/invoices/intake", invoiceIntakeRoutes);
app.use("/api/review", exceptionReviewRoutes);

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
