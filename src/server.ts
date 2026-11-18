import "dotenv/config";
import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";

const app = express();
const port = Number(process.env.PORT || 5000);
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  })
);

// Better Auth route must be mounted before express.json().
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "SalonBook server is running",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "Server is healthy",
  });
});

app.listen(port, () => {
  console.log(`SalonBook server running at http://localhost:${port}`);
});
