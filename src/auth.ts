import "dotenv/config";
import { betterAuth } from "better-auth";
import { admin, jwt } from "better-auth/plugins";
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

const isProduction =
  process.env.NODE_ENV === "production" ||
  (process.env.BETTER_AUTH_URL ?? "").startsWith("https://");

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

  // Client (vercel.app) and server (onrender.com) are on different sites,
  // so cookies must be SameSite=None + Secure in production, otherwise the
  // OAuth state cookie is dropped and Google login fails with state_mismatch.
  advanced: {
    defaultCookieAttributes: isProduction
      ? { sameSite: "none", secure: true }
      : { sameSite: "lax" },
  },

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
    jwt({
      jwt: {
        definePayload: ({ user }) => ({
          id: user.id,
          role: user.role,
        }),
      },
    }),
  ],

  database: mongodbAdapter(database, {
    client: mongoClient,
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    revokeSessionsOnPasswordReset: true,

    sendResetPassword: async ({ user, url }) => {
      const apiKey = process.env.RESEND_API_KEY;
      const fromEmail = process.env.RESEND_FROM_EMAIL;

      if (!apiKey || !fromEmail) {
        console.error(
          "Password reset email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL."
        );
        return;
      }

      const safeUrl = url
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;");

      void fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [user.email],
          subject: "Reset your SalonBook password",
          html: `
            <p>We received a request to reset your SalonBook password.</p>
            <p><a href="${safeUrl}">Reset password</a></p>
            <p>If you did not request this, you can ignore this email.</p>
          `,
          text: `Reset your SalonBook password using this link: ${url}`,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            console.error(
              `Resend rejected the password reset email: ${response.status}`
            );
          }
        })
        .catch((error: unknown) => {
          console.error("Could not send password reset email:", error);
        });
    },
  },

  socialProviders,
});