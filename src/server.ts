import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, type Db } from "mongodb";

const app = express();
const port = Number(process.env.PORT || 5000);
const databaseName = process.env.DB_NAME || "salonbook";

const mongoUri = process.env.MONGODB_URI;
const mongoClient = mongoUri ? new MongoClient(mongoUri) : null;
let databasePromise: Promise<Db> | null = null;

async function getDatabase(): Promise<Db> {
  if (!mongoClient) {
    throw new Error("MONGODB_URI is missing from the server .env file.");
  }

  if (!databasePromise) {
    databasePromise = mongoClient
      .connect()
      .then(() => mongoClient.db(databaseName));
  }

  return databasePromise;
}

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

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

app.get("/api/services", async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit || 6);
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 50)
        : 6;

    const db = await getDatabase();

    const services = await db
      .collection("services")
      .find({ status: "active" })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      count: services.length,
      services,
    });
  } catch (error) {
    console.error("Failed to load services:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load salon services.",
    });
  }
});

app.listen(port, () => {
  console.log(`SalonBook server running at http://localhost:${port}`);
});
