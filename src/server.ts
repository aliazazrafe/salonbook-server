import { sendAppointmentEmail } from "./email.js";
import adminRouter from "./admin.routes.js";
import { paymentRouter, stripeWebhookRouter } from "./payment.routes.js";
import "dotenv/config";
import express from "express";
import cors from "cors";
import { ObjectId } from "mongodb";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { auth, database } from "./auth.js";

const app = express();
const port = Number(process.env.PORT || 5000);
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

const timeOptions = [
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "01:00 PM",
  "02:00 PM",
  "03:00 PM",
  "04:00 PM",
  "05:00 PM",
  "06:00 PM",
  "07:00 PM",
];

const barbers = [
  {
    id: "barber-rahim",
    name: "Rahim Uddin",
    specialty: "Classic cuts & skin fades",
    experienceYears: 8,
  },
  {
    id: "barber-tanvir",
    name: "Tanvir Hasan",
    specialty: "Beard grooming & hot towel shave",
    experienceYears: 6,
  },
  {
    id: "barber-fahim",
    name: "Fahim Ahmed",
    specialty: "Hair treatment & scalp massage",
    experienceYears: 5,
  },
  {
    id: "barber-imran",
    name: "Imran Hossain",
    specialty: "Hair coloring & styling",
    experienceYears: 4,
  },
];
const activeServiceFilter = {
  $or: [
    { isActive: true },
    { active: true },
    { status: { $regex: "^active$", $options: "i" } },
  ],
};

app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  })
);

// Mount Better Auth before express.json().
app.all("/api/auth/*splat", toNodeHandler(auth));

// Stripe needs the raw request body for webhook signature verification.
app.use("/api/payments/webhook", stripeWebhookRouter);

app.use(express.json());
app.use("/api/payments", paymentRouter);
app.use("/api/admin", adminRouter);
app.get("/api/barbers", (_req, res): void => {
  res.json({
    success: true,
    barbers,
  });
});
app.get("/api/offer-settings", async (_req, res): Promise<void> => {
  try {
    const defaultOffer = {
      title: "Friday & Monday Special",
      message:
        "Offers may be changed or updated by the salon management at any time.",
      discountPercent: 47,
      activeDays: ["Friday", "Monday"],
      categories: ["Skin Care", "Hair Treatment", "Spa & Massage"],
      isActive: true,
    };

    const savedOffer = await database
      .collection("offerSettings")
      .findOne({ _id: "salonbook-weekly-offer" } as any);

    res.json({
      success: true,
      offer: savedOffer
        ? { ...defaultOffer, ...savedOffer }
        : defaultOffer,
    });
  } catch (error) {
    console.error("Could not load public offer settings:", error);
    res.status(500).json({
      success: false,
      message: "Could not load offer settings.",
    });
  }
});
app.get("/api/services", async (req, res): Promise<void> => {
  try {
    const requestedLimit = Number(req.query.limit ?? 6);
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 50)
        : 6;

    const services = await database
      .collection("services")
      .find(activeServiceFilter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();

    const formattedServices = services.map((service) => {
      const status =
        typeof service.status === "string" ? service.status : "";
      const isActive =
        service.isActive === true ||
        service.active === true ||
        status.toLowerCase() === "active";

      const image =
        typeof service.image === "string"
          ? service.image
          : typeof service.imageUrl === "string"
            ? service.imageUrl
            : "";

      return {
        _id: service._id.toString(),
        serviceName: service.serviceName || service.name || "",
        name: service.name || service.serviceName || "",
        category: service.category || "Grooming",
        description: service.description || "",
        price: typeof service.price === "number" ? service.price : 0,
        duration: typeof service.duration === "number" ? service.duration : 0,
        image,
        imageUrl: image,
        images: Array.isArray(service.images) ? service.images : [],
        status: status || (isActive ? "Active" : "Inactive"),
        isActive,
      };
    });

    res.json({
      success: true,
      count: formattedServices.length,
      services: formattedServices,
    });
  } catch (error) {
    console.error("Could not load active services:", error);

    res.status(500).json({
      success: false,
      message: "Could not load services.",
    });
  }
});

app.get("/api/services/:id", async (req, res): Promise<void> => {
  try {
    const serviceId = req.params.id;

    if (!ObjectId.isValid(serviceId)) {
      res.status(400).json({
        success: false,
        message: "Invalid service ID.",
      });
      return;
    }

    const service = await database.collection("services").findOne({
      _id: new ObjectId(serviceId),
      ...activeServiceFilter,
    });

    if (!service) {
      res.status(404).json({
        success: false,
        message: "Service not found or inactive.",
      });
      return;
    }

    const status =
      typeof service.status === "string" ? service.status : "";
    const isActive =
      service.isActive === true ||
      service.active === true ||
      status.toLowerCase() === "active";

    const image =
      typeof service.image === "string"
        ? service.image
        : typeof service.imageUrl === "string"
          ? service.imageUrl
          : "";

    res.json({
      success: true,
      service: {
        _id: service._id.toString(),
        serviceName: service.serviceName || service.name || "",
        name: service.name || service.serviceName || "",
        category: service.category || "Grooming",
        description: service.description || "",
        price: typeof service.price === "number" ? service.price : 0,
        duration: typeof service.duration === "number" ? service.duration : 0,
        image,
        imageUrl: image,
        images: Array.isArray(service.images) ? service.images : [],
        status: status || (isActive ? "Active" : "Inactive"),
        isActive,
      },
    });
  } catch (error) {
    console.error("Could not load service details:", error);

    res.status(500).json({
      success: false,
      message: "Could not load service details.",
    });
  }
});

app.get("/api/services/:id/reviews", async (req, res): Promise<void> => {
  try {
    const serviceId = req.params.id;

    if (!ObjectId.isValid(serviceId)) {
      res.status(400).json({ success: false, message: "Invalid service ID." });
      return;
    }

    const service = await database.collection("services").findOne({
      _id: new ObjectId(serviceId),
      ...activeServiceFilter,
    });

    if (!service) {
      res.status(404).json({ success: false, message: "Service not found." });
      return;
    }

    const reviews = await database
      .collection("reviews")
      .find({ serviceId })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    const safeReviews = reviews.map((review) => ({
      _id: review._id.toString(),
      userName: review.userName || "SalonBook customer",
      rating: Number(review.rating) || 0,
      comment: review.comment || "",
      createdAt: review.createdAt || null,
    }));

    const averageRating =
      safeReviews.length > 0
        ? Math.round(
            (safeReviews.reduce((sum, review) => sum + review.rating, 0) /
              safeReviews.length) *
              10
          ) / 10
        : 0;

    res.json({
      success: true,
      reviews: safeReviews,
      averageRating,
      reviewCount: safeReviews.length,
    });
  } catch (error) {
    console.error("Could not load service reviews:", error);
    res.status(500).json({
      success: false,
      message: "Could not load reviews.",
    });
  }
});

app.post("/api/services/:id/reviews", async (req, res): Promise<void> => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({
        success: false,
        message: "Please sign in to leave a review.",
      });
      return;
    }

    const serviceId = req.params.id;

    if (!ObjectId.isValid(serviceId)) {
      res.status(400).json({ success: false, message: "Invalid service ID." });
      return;
    }

    const service = await database.collection("services").findOne({
      _id: new ObjectId(serviceId),
      ...activeServiceFilter,
    });

    if (!service) {
      res.status(404).json({ success: false, message: "Service not found." });
      return;
    }

    const rating = Number(req.body?.rating);
    const comment =
      typeof req.body?.comment === "string" ? req.body.comment.trim() : "";

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({
        success: false,
        message: "Choose a rating from 1 to 5 stars.",
      });
      return;
    }

    if (comment.length < 8 || comment.length > 1000) {
      res.status(400).json({
        success: false,
        message: "Review must be between 8 and 1000 characters.",
      });
      return;
    }

    const serviceName = service.serviceName || service.name || "";
    const reviews = database.collection("reviews");

    const existingReview = await reviews.findOne({
      serviceId,
      userId: session.user.id,
    });

    if (existingReview) {
      res.status(409).json({
        success: false,
        message: "You have already reviewed this service.",
      });
      return;
    }

    const todayInDhaka = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
    }).format(new Date());

    const confirmedPastAppointment = await database
      .collection("appointments")
      .findOne({
        userId: session.user.id,
        service: serviceName,
        status: "Confirmed",
        date: { $lt: todayInDhaka },
      });

    if (!confirmedPastAppointment) {
      res.status(403).json({
        success: false,
        message:
          "You can review this service after a confirmed appointment has taken place.",
      });
      return;
    }

    const now = new Date();
    const review = {
      serviceId,
      serviceName,
      userId: session.user.id,
      userName: session.user.name || "SalonBook customer",
      rating,
      comment,
      createdAt: now,
      updatedAt: now,
    };

    const result = await reviews.insertOne(review);

    res.status(201).json({
      success: true,
      message: "Review submitted successfully.",
      review: {
        _id: result.insertedId.toString(),
        userName: review.userName,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
      },
    });
  } catch (error) {
    console.error("Could not submit service review:", error);
    res.status(500).json({
      success: false,
      message: "Could not submit your review.",
    });
  }
});
app.get("/api/appointments/availability", async (req, res): Promise<void> => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date : "";
    const barberId =
      typeof req.query.barberId === "string" ? req.query.barberId : "";

    if (!barbers.some((barber) => barber.id === barberId)) {
      res.status(400).json({
        success: false,
        message: "Please select a valid barber.",
      });
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({
        success: false,
        message: "Please provide a valid appointment date.",
      });
      return;
    }

    const parsedDate = new Date(`${date}T00:00:00.000Z`);

    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      res.status(400).json({
        success: false,
        message: "Please provide a valid appointment date.",
      });
      return;
    }

    const bookedAppointments = await database
      .collection("appointments")
      .find({
        date,
        status: { $in: ["Pending", "Confirmed"] },
        $or: [
          { barberId },
          { barberId: { $exists: false } },
        ],
      })
      .project({ time: 1, _id: 0 })
      .toArray();

    const bookedTimes = bookedAppointments
      .map((appointment) => appointment.time)
      .filter((time): time is string => typeof time === "string");

    const availableTimes = timeOptions.filter(
      (time) => !bookedTimes.includes(time)
    );

    res.json({
      success: true,
      date,
      bookedTimes,
      availableTimes,
    });
  } catch (error) {
    console.error("Could not load appointment availability:", error);
    res.status(500).json({
      success: false,
      message: "Could not load available appointment times.",
    });
  }
});
app.get("/api/appointments/mine", async (req, res): Promise<void> => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({
        success: false,
        message: "Please sign in to view your appointments.",
      });
      return;
    }

    const appointments = await database
      .collection("appointments")
      .find({ userId: session.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      appointments: appointments.map((appointment) => ({
        ...appointment,
        _id: appointment._id.toString(),
      })),
    });
  } catch (error) {
    console.error("Could not load appointments:", error);

    res.status(500).json({
      success: false,
      message: "Could not load appointments.",
    });
  }
});

app.delete("/api/appointments/:id", async (req, res): Promise<void> => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({
        success: false,
        message: "Please sign in to cancel an appointment.",
      });
      return;
    }

    const appointmentId = req.params.id;

    if (!ObjectId.isValid(appointmentId)) {
      res.status(400).json({
        success: false,
        message: "Invalid appointment ID.",
      });
      return;
    }

    const appointments = database.collection("appointments");
    const filter = {
      _id: new ObjectId(appointmentId),
      userId: session.user.id,
    };

    const appointment = await appointments.findOne(filter);

    if (!appointment) {
      res.status(404).json({
        success: false,
        message: "Appointment not found.",
      });
      return;
    }

    if (appointment.status !== "Pending") {
      res.status(409).json({
        success: false,
        message: "Only pending appointments can be cancelled.",
      });
      return;
    }

    await appointments.updateOne(filter, {
      $set: {
        status: "Cancelled",
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: "Appointment cancelled successfully.",
    });
  } catch (error) {
    console.error("Could not cancel appointment:", error);

    res.status(500).json({
      success: false,
      message: "Could not cancel the appointment.",
    });
  }
});

app.post("/api/appointments", async (req, res): Promise<void> => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({
        success: false,
        message: "Please sign in before booking an appointment.",
      });
      return;
    }

    const body = req.body ?? {};

    const service =
      typeof body.service === "string" ? body.service.trim() : "";    const barberId =
      typeof body.barberId === "string" ? body.barberId.trim() : "";
    const selectedBarber = barbers.find((barber) => barber.id === barberId);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const date = typeof body.date === "string" ? body.date.trim() : "";
    const time = typeof body.time === "string" ? body.time.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";

    if (!service || !barberId || !name || !phone || !email || !date || !time) {
      res.status(400).json({
        success: false,
        message: "Please complete all required fields.",
      });
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({
        success: false,
        message: "Please select a valid date.",
      });
      return;
    }

    const parsedDate = new Date(`${date}T00:00:00.000Z`);

    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      res.status(400).json({
        success: false,
        message: "Please select a valid date.",
      });
      return;
    }

    if (!selectedBarber) {
      res.status(400).json({
        success: false,
        message: "Please select a valid barber.",
      });
      return;
    }
    if (!timeOptions.includes(time)) {
      res.status(400).json({
        success: false,
        message: "Please select a valid time from the list.",
      });
      return;
    }

    const appointments = database.collection("appointments");

    const existingAppointment = await appointments.findOne({
      date,
      time,
      status: { $in: ["Pending", "Confirmed"] },
      $or: [
        { barberId },
        { barberId: { $exists: false } },
      ],
    });

    if (existingAppointment) {
      res.status(409).json({
        success: false,
        message:
          "An appointment already exists for this time. Please choose another time.",
      });
      return;
    }

    const result = await appointments.insertOne({
      userId: session.user.id,
      service,
      barberId,
      barberName: selectedBarber.name,
      barberSpecialty: selectedBarber.specialty,
      name,
      phone,
      email,
      date,
      time,
      notes,
      status: "Pending",
      paymentStatus: "Unpaid",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await sendAppointmentEmail({
      email,
      name,
      service,
      barberName: selectedBarber.name,
      date,
      time,
      status: "Pending",
    });

    res.status(201).json({
      success: true,
      message: "Appointment request saved successfully.",
      appointmentId: result.insertedId,
    });
  } catch (error) {
    console.error("Appointment request failed:", error);

    res.status(500).json({
      success: false,
      message: "Could not save the appointment. Please try again.",
    });
  }
});

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





