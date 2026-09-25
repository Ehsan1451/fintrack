import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import authRouter from "./routes/auth.js";

dotenv.config()

const app = express()
const port = Number(process.env.PORT) || 5000

app.use(cors())
app.use(express.json())
app.use("/api/auth", authRouter);

app.get('/api/health', (_request, response) => {
  response.json({
    success: true,
    message: 'FinTrack API is running',
  })
})

app.listen(port, () => {
  console.log(`FinTrack API running at http://localhost:${port}`)
})
