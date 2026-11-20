import "dotenv/config";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { MongoClient } from "mongodb";

const mongoUri = process.env.MONGODB_URI;
const authSecret = process.env.BETTER_AUTH_SECRET;

if (!mongoUri) {
  throw new Error("MONGODB_URI is missing from the server .env file");
}

if (!authSecret) {
  throw new Error("BETTER_AUTH_SECRET is missing from the server .env file");
}

const mongoClient = new MongoClient(mongoUri);

export const database = mongoClient.db(
  process.env.MONGODB_DB_NAME || "salonbook"
);

const socialProviders = {
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {}),
  ...(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET
    ? {
        facebook: {
          clientId: process.env.FACEBOOK_CLIENT_ID,
          clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
        },
      }
    : {}),
};

export const auth = betterAuth({
  appName: "SalonBook",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
  secret: authSecret,
  trustedOrigins: [process.env.CLIENT_URL || "http://localhost:3000"],

  user: {
    additionalFields: {
      role: {
        type: ["customer", "admin"],
        required: false,
        defaultValue: "customer",
        input: false,
      },
    },
  },

  plugins: [
    admin({
      defaultRole: "customer",
      adminRoles: ["admin"],
    }),
  ],

  database: mongodbAdapter(database, {
    client: mongoClient,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
  },
  socialProviders,
});
