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
  {
    serviceName: "Hot Towel Shave",
    category: "Beard Grooming",
    description: "A traditional close shave with a soothing hot towel.",
    price: 700,
    duration: 40,
    image:
      "https://lon1.digitaloceanspaces.com/www-tedsgroomingroom-com/locations/28/281703172862.jpg",
  },
  {
    serviceName: "Mustache Trim",
    category: "Beard Grooming",
    description: "A neat mustache trim shaped to suit your style.",
    price: 300,
    duration: 20,
    image:
      "https://cdn.prod.website-files.com/6734c0c08e2297081697206c/6759cb71b00ffecf03c19b23_men4.webp",
  },
  {
    serviceName: "Hair Spa Treatment",
    category: "Hair Treatment",
    description: "A nourishing hair spa treatment for healthier-looking hair.",
    price: 1200,
    duration: 60,
    image:
      "https://img1.wsimg.com/isteam/ip/dbbb5924-150a-4ec7-a833-ef2cb590d0c3/Men%20Head%20Spa.png",
  },
  {
    serviceName: "Men’s Facial Cleanup",
    category: "Skin Care",
    description: "A refreshing facial cleanup to leave skin feeling fresh.",
    price: 1000,
    duration: 45,
    image:
      "https://static.wixstatic.com/media/9706d2_ef204f7132e84d1f916c1f48a8b46c87~mv2.png/v1/fill/w_980%2Ch_655%2Cal_c%2Cq_90%2Cusm_0.66_1.00_0.01%2Cenc_avif%2Cquality_auto/9706d2_ef204f7132e84d1f916c1f48a8b46c87~mv2.png",
  },
  {
    serviceName: "Scalp Massage",
    category: "Hair Treatment",
    description: "A relaxing scalp massage to ease tension and refresh.",
    price: 500,
    duration: 25,
    image:
      "https://www.welefulunisexsalon.com/images/services/head-massage-for-hair-and-scalp-health1.png",
  },
  {
    serviceName: "Hair Straightening",
    category: "Hair Treatment",
    description: "Professional styling for a smooth, straight finish.",
    price: 2000,
    duration: 90,
    image:
      "https://static.wixstatic.com/media/3681fc_b898f7cd2e9a437898cd4366353283be~mv2.jpg/v1/fit/w_500%2Ch_500%2Cq_90/file.jpg",
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
      .slice(0, Math.max(0, 12 - existing.length));

    if (missingServices.length > 0) {
      await collection.insertMany(missingServices);
      console.log(`Added ${missingServices.length} missing services.`);
    } else {
      console.log("No missing services needed to be added.");
    }

    let updatedImages = 0;

    for (const service of seedServices) {
      const result = await collection.updateOne(
        { serviceName: service.serviceName },
        {
          $set: {
            image: service.image,
            updatedAt: new Date(),
          },
        }
      );

      updatedImages += result.modifiedCount;
    }

    console.log(`Updated service images: ${updatedImages}`);

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