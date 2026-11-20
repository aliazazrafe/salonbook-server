import "dotenv/config";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB_NAME || "salonbook";

if (!uri) {
  throw new Error("MONGODB_URI is missing from the server .env file");
}

const seedServices = [
  {
    serviceName: "Classic Haircut",
    category: "Haircut & Styling",
    description: "A clean, classic haircut tailored to your style.",
    price: 800,
    duration: 45,
    image:
      "https://images.pexels.com/photos/7518755/pexels-photo-7518755.jpeg?auto=compress&dpr=1&h=750&w=1260",
  },
  {
    serviceName: "Skin Fade",
    category: "Haircut & Styling",
    description: "A sharp fade with a clean, polished finish.",
    price: 900,
    duration: 50,
    image:
      "https://images.unsplash.com/photo-1703792686383-4f307cbfa544?auto=format&fit=crop&w=900&q=85",
  },
  {
    serviceName: "Buzz Cut",
    category: "Haircut & Styling",
    description: "A neat, low-maintenance cut with an even finish.",
    price: 600,
    duration: 30,
    image:
      "https://images.unsplash.com/photo-1653875700322-cf550d9a52ff?auto=format&fit=crop&w=900&q=85",
  },
  {
    serviceName: "Hair Wash & Styling",
    category: "Hair Treatment",
    description: "A relaxing wash followed by professional styling.",
    price: 600,
    duration: 35,
    image:
      "https://images.pexels.com/photos/17553843/pexels-photo-17553843/free-photo-of-hairdresser-washing-man-head.jpeg?auto=compress&dpr=1&h=750&w=1260",
  },
  {
    serviceName: "Men’s Hair Coloring",
    category: "Hair Coloring",
    description: "Professional color treatment for men’s hair.",
    price: 1800,
    duration: 90,
    image:
      "https://images.pexels.com/photos/7389077/pexels-photo-7389077.jpeg?auto=compress&dpr=1&h=750&w=1260",
  },
  {
    serviceName: "Beard Trim & Shape",
    category: "Beard Grooming",
    description: "A precise trim with a clean, defined beard shape.",
    price: 500,
    duration: 30,
    image:
      "https://images.unsplash.com/photo-1599011176306-4a96f1516d4d?auto=format&fit=crop&w=900&q=85",
  },
].map((service) => ({
  ...service,
  isActive: true,
  status: "Active",
  createdAt: new Date(),
  updatedAt: new Date(),
}));

async function runSeedServices() {
  const client = new MongoClient(uri!);

  try {
    await client.connect();

    const collection = client.db(databaseName).collection("services");
    const activeFilter = {
      $or: [
        { isActive: true },
        { active: true },
        { status: { $regex: "^active$", $options: "i" } },
      ],
    };

    const existing = await collection
      .find(activeFilter)
      .project({ serviceName: 1 })
      .toArray();

    const existingNames = new Set(
      existing
        .map((service) =>
          typeof service.serviceName === "string"
            ? service.serviceName.toLowerCase()
            : ""
        )
        .filter(Boolean)
    );

    const missingServices = seedServices
      .filter(
        (service) => !existingNames.has(service.serviceName.toLowerCase())
      )
      .slice(0, Math.max(0, 6 - existing.length));

    if (missingServices.length > 0) {
      await collection.insertMany(missingServices);
    }

    const activeCount = await collection.countDocuments(activeFilter);
    console.log(`Active services in database: ${activeCount}`);
  } finally {
    await client.close();
  }
}

runSeedServices().catch((error: unknown) => {
  console.error("Could not seed services:", error);
  process.exitCode = 1;
});


