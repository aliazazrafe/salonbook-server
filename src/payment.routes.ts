import express, { Router } from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";
import { auth, database } from "./auth.js";

const paymentRouter = Router();
const stripeWebhookRouter = Router();

const DEFAULT_OFFER = {
  active: true,
  discountPercent: 47,
  days: ["Friday", "Monday"],
  categories: ["Skin Care", "Hair Treatment", "Spa & Massage"],
};

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is missing from the server .env file.");
  }

  return new Stripe(secretKey);
}

function getAppointmentWeekday(dateValue: unknown): string {
  if (typeof dateValue !== "string") return "";

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateValue);
  if (!match) return "";

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return fallback;
}

async function calculateAppointmentPrice(
  service: Record<string, unknown> | null,
  appointment: Record<string, unknown>
) {
  const regularPrice = Number(service?.price);

  if (!Number.isFinite(regularPrice) || regularPrice <= 0) {
    throw new Error("Could not find a valid price for this service.");
  }

  const settings = await database
    .collection("offerSettings")
    .findOne({ _id: "salonbook-weekly-offer" } as any);

  const offer: Record<string, unknown> = (settings || DEFAULT_OFFER) as Record<string, unknown>;
  const isActive = offer.isActive ?? offer.active ?? true;
  const discountPercent = Number(
    offer.discountPercent ?? offer.percentage ?? offer.percent ?? 47
  );
  const offerDays = asStringArray(
    offer.activeDays ?? offer.days ?? offer.applicableDays,
    DEFAULT_OFFER.days
  );
  const offerCategories = asStringArray(
    offer.categories ?? offer.applicableCategories,
    DEFAULT_OFFER.categories
  );

  const serviceName = String(
    service?.serviceName ?? service?.name ?? appointment.service ?? ""
  );
  const serviceCategory = String(service?.category ?? "");

  const categoryEligible = offerCategories.some((category) => {
    const normalizedCategory = category.toLowerCase();
    return (
      serviceCategory.toLowerCase().includes(normalizedCategory) ||
      normalizedCategory.includes(serviceCategory.toLowerCase())
    );
  });

  const nameEligible = /spa|massage/i.test(serviceName);
  const weekday = getAppointmentWeekday(appointment.date);
  const dayEligible = offerDays.some(
    (day) => day.toLowerCase() === weekday.toLowerCase()
  );

  const offerApplied =
    Boolean(isActive) &&
    dayEligible &&
    (categoryEligible || nameEligible) &&
    Number.isFinite(discountPercent) &&
    discountPercent > 0 &&
    discountPercent < 100;

  const appliedPercent = offerApplied ? discountPercent : 0;
  const finalPrice = offerApplied
    ? Math.round(regularPrice * (100 - appliedPercent) / 100)
    : Math.round(regularPrice);

  return {
    regularPrice: Math.round(regularPrice),
    discountPercent: appliedPercent,
    discountAmount: Math.round(regularPrice) - finalPrice,
    finalPrice,
    offerApplied,
    weekday,
  };
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

    const priceDetails = await calculateAppointmentPrice(
      service as Record<string, unknown> | null,
      appointment
    );

    const clientUrl = (
      process.env.CLIENT_URL || "http://localhost:3000"
    ).replace(/\/+$/, "");

    const checkoutSession = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "bdt",
            unit_amount: priceDetails.finalPrice * 100,
            product_data: {
              name: priceDetails.offerApplied
                ? `${String(appointment.service)} (${priceDetails.discountPercent}% off)`
                : String(appointment.service),
              description: priceDetails.offerApplied
                ? `Regular price ৳${priceDetails.regularPrice}; offer price ৳${priceDetails.finalPrice}`
                : undefined,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        appointmentId,
        userId: session.user.id,
        regularPrice: String(priceDetails.regularPrice),
        discountPercent: String(priceDetails.discountPercent),
        discountAmount: String(priceDetails.discountAmount),
        finalPrice: String(priceDetails.finalPrice),
        offerApplied: String(priceDetails.offerApplied),
      },
      success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/payment/cancel?appointmentId=${appointmentId}`,
    });

    await appointments.updateOne(
      { _id: new ObjectId(appointmentId), userId: session.user.id },
      {
        $set: {
          regularPrice: priceDetails.regularPrice,
          discountPercent: priceDetails.discountPercent,
          discountAmount: priceDetails.discountAmount,
          finalPrice: priceDetails.finalPrice,
          offerApplied: priceDetails.offerApplied,
          stripeCheckoutSessionId: checkoutSession.id,
          updatedAt: new Date(),
        },
      }
    );

    res.json({
      success: true,
      url: checkoutSession.url,
      price: priceDetails.finalPrice,
      regularPrice: priceDetails.regularPrice,
      discountPercent: priceDetails.discountPercent,
      offerApplied: priceDetails.offerApplied,
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


