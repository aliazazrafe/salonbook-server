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

app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  })
);

// Mount Better Auth before express.json().
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

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
      typeof body.service === "string" ? body.service.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const date = typeof body.date === "string" ? body.date.trim() : "";
    const time = typeof body.time === "string" ? body.time.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";

    if (!service || !name || !phone || !email || !date || !time) {
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