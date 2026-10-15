import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import authRouter from "./routes/auth.js";
import budgetsRouter from "./routes/budgets.js";
import recurringTransactionsRouter from "./routes/recurring-transactions.js";
import savingsGoalsRouter from "./routes/savings-goals.js";
import transactionsRouter from "./routes/transactions.js";

dotenv.config()

const app = express();

app.use(cors())
app.use(express.json())
app.use("/api/auth", authRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/budgets", budgetsRouter);
app.use("/api/recurring-transactions", recurringTransactionsRouter);
app.use("/api/savings-goals", savingsGoalsRouter);

app.get('/api/health', (_request, response) => {
  response.json({
    success: true,
    message: 'FinTrack API is running',
  })
})

export default app;
