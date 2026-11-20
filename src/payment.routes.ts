import express, { Router } from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";
import { auth, database } from "./auth.js";

const paymentRouter = Router();
const stripeWebhookRouter = Router();

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is missing from the server .env file.");
  }

  return new Stripe(secretKey);
}

paymentRouter.post("/checkout-session", async (req, res): Promise<void> => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({
        success: false,
        message: "Please sign in before paying.",
      });
      return;
    }

    const appointmentId =
      typeof req.body?.appointmentId === "string"
        ? req.body.appointmentId.trim()
        : "";

    if (!ObjectId.isValid(appointmentId)) {
      res.status(400).json({
        success: false,
        message: "Invalid appointment ID.",
      });
      return;
    }

    const appointments = database.collection("appointments");
    const appointment = await appointments.findOne({
      _id: new ObjectId(appointmentId),
      userId: session.user.id,
    });

    if (!appointment) {
      res.status(404).json({
        success: false,
        message: "Appointment not found.",
      });
      return;
    }

    if (appointment.status !== "Confirmed") {
      res.status(409).json({
        success: false,
        message: "Only confirmed appointments can be paid.",
      });
      return;
    }

    if (appointment.paymentStatus === "Paid") {
      res.status(409).json({
        success: false,
        message: "This appointment has already been paid.",
      });
      return;
    }

    const service = await database.collection("services").findOne({
      $or: [
        { serviceName: appointment.service },
        { name: appointment.service },
      ],
    });

    const price = Number(service?.price);

    if (!Number.isFinite(price) || price <= 0) {
      res.status(400).json({
        success: false,
        message: "Could not find a valid price for this service.",
      });
      return;
    }

    const clientUrl = (
      process.env.CLIENT_URL || "http://localhost:3000"
    ).replace(/\/+$/, "");

    const checkoutSession = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "bdt",
            unit_amount: Math.round(price * 100),
            product_data: {
              name: String(appointment.service),
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        appointmentId,
        userId: session.user.id,
      },
      success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/payment/cancel?appointmentId=${appointmentId}`,
    });

    await appointments.updateOne(
      { _id: new ObjectId(appointmentId), userId: session.user.id },
      {
        $set: {
          stripeCheckoutSessionId: checkoutSession.id,
          updatedAt: new Date(),
        },
      }
    );

    res.json({
      success: true,
      url: checkoutSession.url,
    });
  } catch (error) {
    console.error("Could not create Stripe Checkout session:", error);
    res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Could not start payment.",
    });
  }
});

stripeWebhookRouter.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res): Promise<void> => {
    const signature = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || Array.isArray(signature) || !webhookSecret) {
      res.status(400).send("Missing Stripe webhook signature or secret.");
      return;
    }

    let event: Stripe.Event;

    try {
      event = getStripe().webhooks.constructEvent(
        req.body,
        signature,
        webhookSecret
      );
    } catch (error) {
      console.error("Stripe webhook signature check failed:", error);
      res.status(400).send("Invalid Stripe webhook signature.");
      return;
    }

    try {
      if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded"
      ) {
        const checkoutSession = event.data.object as Stripe.Checkout.Session;
        const appointmentId = checkoutSession.metadata?.appointmentId;
        const userId = checkoutSession.metadata?.userId;

        if (
          checkoutSession.payment_status === "paid" &&
          appointmentId &&
          ObjectId.isValid(appointmentId)
        ) {
          const paymentIntentId =
            typeof checkoutSession.payment_intent === "string"
              ? checkoutSession.payment_intent
              : checkoutSession.payment_intent?.id || "";

          await database.collection("appointments").updateOne(
            {
              _id: new ObjectId(appointmentId),
              ...(userId ? { userId } : {}),
            },
            {
              $set: {
                paymentStatus: "Paid",
                stripeCheckoutSessionId: checkoutSession.id,
                stripePaymentIntentId: paymentIntentId,
                paidAt: new Date(),
                updatedAt: new Date(),
              },
            }
          );

          await database.collection("transactions").updateOne(
            { stripeCheckoutSessionId: checkoutSession.id },
            {
              $setOnInsert: {
                appointmentId,
                userId: userId || "",
                stripeCheckoutSessionId: checkoutSession.id,
                stripePaymentIntentId: paymentIntentId,
                amount: checkoutSession.amount_total || 0,
                currency: checkoutSession.currency || "bdt",
                status: "Paid",
                createdAt: new Date(),
              },
            },
            { upsert: true }
          );
        }
      }

      if (event.type === "checkout.session.async_payment_failed") {
        const checkoutSession = event.data.object as Stripe.Checkout.Session;
        const appointmentId = checkoutSession.metadata?.appointmentId;
        const userId = checkoutSession.metadata?.userId;

        if (appointmentId && ObjectId.isValid(appointmentId)) {
          await database.collection("appointments").updateOne(
            {
              _id: new ObjectId(appointmentId),
              ...(userId ? { userId } : {}),
              paymentStatus: { $ne: "Paid" },
            },
            {
              $set: {
                paymentStatus: "Failed",
                updatedAt: new Date(),
              },
            }
          );
        }
      }

      res.json({ received: true });
    } catch (error) {
      console.error("Could not process Stripe webhook event:", error);
      res.status(500).json({ success: false });
    }
  }
);

export { paymentRouter, stripeWebhookRouter };


