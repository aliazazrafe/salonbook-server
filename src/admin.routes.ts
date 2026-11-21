import { sendAppointmentEmail } from "./email.js";
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";
import { auth, database } from "./auth.js";

const adminRouter = Router();

const activeServiceFilter = {
  $or: [
    { isActive: true },
    { active: true },
    { status: { $regex: "^active$", $options: "i" } },
  ],
};

async function requireAdmin(req: Request, res: Response) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    res.status(401).json({
      success: false,
      message: "Please sign in.",
    });
    return false;
  }

  const role = (session.user as typeof session.user & { role?: string }).role;

  if (role?.toLowerCase() !== "admin") {
    res.status(403).json({
      success: false,
      message: "Admin access is required.",
    });
    return false;
  }

  return true;
}

function formatService(service: Record<string, any>) {
  const status = typeof service.status === "string" ? service.status : "";
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
    category: service.category || "",
    description: service.description || "",
    price: typeof service.price === "number" ? service.price : 0,
    duration: typeof service.duration === "number" ? service.duration : 0,
    image,
    imageUrl: image,
    images: Array.isArray(service.images) ? service.images : [],
    status: status || (isActive ? "Active" : "Inactive"),
    isActive,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

adminRouter.get("/overview", async (req, res): Promise<void> => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const appointments = database.collection("appointments");
    const services = database.collection("services");

    const [
      totalAppointments,
      pendingAppointments,
      confirmedAppointments,
      cancelledAppointments,
      totalServices,
      activeServices,
    ] = await Promise.all([
      appointments.countDocuments(),
      appointments.countDocuments({ status: "Pending" }),
      appointments.countDocuments({ status: "Confirmed" }),
      appointments.countDocuments({ status: "Cancelled" }),
      services.countDocuments(),
      services.countDocuments(activeServiceFilter),
    ]);

    res.json({
      success: true,
      overview: {
        appointments: {
          total: totalAppointments,
          pending: pendingAppointments,
          confirmed: confirmedAppointments,
          cancelled: cancelledAppointments,
        },
        services: {
          total: totalServices,
          active: activeServices,
        },
      },
    });
  } catch (error) {
    console.error("Could not load admin overview:", error);
    res.status(500).json({
      success: false,
      message: "Could not load admin overview.",
    });
  }
});

adminRouter.get("/services", async (req, res): Promise<void> => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const services = await database
      .collection("services")
      .find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.json({
      success: true,
      services: services.map((service) => formatService(service)),
    });
  } catch (error) {
    console.error("Could not load admin services:", error);
    res.status(500).json({
      success: false,
      message: "Could not load services.",
    });
  }
});

adminRouter.post("/services", async (req, res): Promise<void> => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const body = req.body ?? {};
    const serviceName =
      typeof body.serviceName === "string"
        ? body.serviceName.trim()
        : typeof body.name === "string"
          ? body.name.trim()
          : "";
    const category =
      typeof body.category === "string" ? body.category.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const price = Number(body.price);
    const duration = Number(body.duration);
    const image =
      typeof body.image === "string"
        ? body.image.trim()
        : typeof body.imageUrl === "string"
          ? body.imageUrl.trim()
          : "";

    if (
      !serviceName ||
      !category ||
      !description ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isInteger(duration) ||
      duration <= 0
    ) {
      res.status(400).json({
        success: false,
        message:
          "Provide a service name, category, description, valid price, and duration.",
      });
      return;
    }

    const isActive = body.isActive !== false;
    const now = new Date();

    const newService = {
      serviceName,
      name: serviceName,
      category,
      description,
      price,
      duration,
      image,
      imageUrl: image,
      images: image ? [image] : [],
      isActive,
      status: isActive ? "Active" : "Inactive",
      createdAt: now,
      updatedAt: now,
    };

    const result = await database
      .collection("services")
      .insertOne(newService);

    res.status(201).json({
      success: true,
      message: "Service created successfully.",
      service: formatService({
        ...newService,
        _id: result.insertedId,
      }),
    });
  } catch (error) {
    console.error("Could not create service:", error);
    res.status(500).json({
      success: false,
      message: "Could not create service.",
    });
  }
});

adminRouter.patch("/services/:id", async (req, res): Promise<void> => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const serviceId = req.params.id;

    if (!ObjectId.isValid(serviceId)) {
      res.status(400).json({
        success: false,
        message: "Invalid service ID.",
      });
      return;
    }

    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};

    if (body.serviceName !== undefined || body.name !== undefined) {
      const serviceName =
        typeof body.serviceName === "string"
          ? body.serviceName.trim()
          : typeof body.name === "string"
            ? body.name.trim()
            : "";

      if (!serviceName) {
        res.status(400).json({
          success: false,
          message: "Service name cannot be empty.",
        });
        return;
      }

      updates.serviceName = serviceName;
      updates.name = serviceName;
    }

    if (body.category !== undefined) {
      if (typeof body.category !== "string" || !body.category.trim()) {
        res.status(400).json({
          success: false,
          message: "Category cannot be empty.",
        });
        return;
      }
      updates.category = body.category.trim();
    }

    if (body.description !== undefined) {
      if (typeof body.description !== "string" || !body.description.trim()) {
        res.status(400).json({
          success: false,
          message: "Description cannot be empty.",
        });
        return;
      }
      updates.description = body.description.trim();
    }

    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) {
        res.status(400).json({
          success: false,
          message: "Price must be zero or greater.",
        });
        return;
      }
      updates.price = price;
    }

    if (body.duration !== undefined) {
      const duration = Number(body.duration);
      if (!Number.isInteger(duration) || duration <= 0) {
        res.status(400).json({
          success: false,
          message: "Duration must be a positive whole number.",
        });
        return;
      }
      updates.duration = duration;
    }

    if (body.image !== undefined || body.imageUrl !== undefined) {
      const image =
        typeof body.image === "string"
          ? body.image.trim()
          : typeof body.imageUrl === "string"
            ? body.imageUrl.trim()
            : "";

      updates.image = image;
      updates.imageUrl = image;
      updates.images = image ? [image] : [];
    }

    if (typeof body.isActive === "boolean") {
      updates.isActive = body.isActive;
      updates.status = body.isActive ? "Active" : "Inactive";
    } else if (typeof body.status === "string") {
      const normalizedStatus = body.status.toLowerCase();

      if (!["active", "inactive"].includes(normalizedStatus)) {
        res.status(400).json({
          success: false,
          message: "Status must be Active or Inactive.",
        });
        return;
      }

      const isActive = normalizedStatus === "active";
      updates.isActive = isActive;
      updates.status = isActive ? "Active" : "Inactive";
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({
        success: false,
        message: "No valid service fields were provided.",
      });
      return;
    }

    updates.updatedAt = new Date();

    const collection = database.collection("services");
    const filter = { _id: new ObjectId(serviceId) };
    const updateResult = await collection.updateOne(filter, {
      $set: updates,
    });

    if (updateResult.matchedCount === 0) {
      res.status(404).json({
        success: false,
        message: "Service not found.",
      });
      return;
    }

    const service = await collection.findOne(filter);

    res.json({
      success: true,
      message: "Service updated successfully.",
      service: service ? formatService(service) : null,
    });
  } catch (error) {
    console.error("Could not update service:", error);
    res.status(500).json({
      success: false,
      message: "Could not update service.",
    });
  }
});

adminRouter.get("/appointments", async (req, res): Promise<void> => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const appointments = await database
      .collection("appointments")
      .find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.json({
      success: true,
      appointments: appointments.map((appointment) => ({
        ...appointment,
        _id: appointment._id.toString(),
      })),
    });
  } catch (error) {
    console.error("Could not load admin appointments:", error);
    res.status(500).json({
      success: false,
      message: "Could not load appointments.",
    });
  }
});

adminRouter.patch(
  "/appointments/:id/status",
  async (req, res): Promise<void> => {
    try {
      if (!(await requireAdmin(req, res))) return;

      const appointmentId = req.params.id;
      const status = req.body?.status;

      if (!ObjectId.isValid(appointmentId)) {
        res.status(400).json({
          success: false,
          message: "Invalid appointment ID.",
        });
        return;
      }

      if (!["Confirmed", "Cancelled"].includes(status)) {
        res.status(400).json({
          success: false,
          message: "Status must be Confirmed or Cancelled.",
        });
        return;
      }

      const collection = database.collection("appointments");
      const filter = { _id: new ObjectId(appointmentId) };
      
      const previousAppointment = await collection.findOne(filter);

      const updateResult = await collection.updateOne(filter, {
        $set: {
          status,
          updatedAt: new Date(),
        },
      });

      if (updateResult.matchedCount === 0) {
        res.status(404).json({
          success: false,
          message: "Appointment not found.",
        });
        return;
      }

      const appointment = await collection.findOne(filter);
      if (appointment && previousAppointment?.status !== status) {
        await sendAppointmentEmail({
          email: appointment.email,
          name: appointment.name,
          service: appointment.service,
          barberName: appointment.barberName,
          date: appointment.date,
          time: appointment.time,
          status,
        });
      }

      res.json({
        success: true,
        message: `Appointment ${status.toLowerCase()} successfully.`,
        appointment: appointment
          ? { ...appointment, _id: appointment._id.toString() }
          : null,
      });
    } catch (error) {
      console.error("Could not update appointment status:", error);
      res.status(500).json({
        success: false,
        message: "Could not update appointment status.",
      });
    }
  }
);


adminRouter.get("/users", async (req, res): Promise<void> => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const users = await database
      .collection("user")
      .find(
        { role: { $ne: "admin" } },
        {
          projection: {
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            banned: 1,
            banReason: 1,
            createdAt: 1,
          },
        }
      )
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.json({
      success: true,
      users: users.map((user) => ({
        _id: user._id.toString(),
        name: user.name || "",
        email: user.email || "",
        image: user.image || "",
        role: user.role || "customer",
        banned: user.banned === true,
        banReason: user.banReason || "",
        createdAt: user.createdAt || null,
      })),
    });
  } catch (error) {
    console.error("Could not load admin users:", error);
    res.status(500).json({
      success: false,
      message: "Could not load users.",
    });
  }
});

adminRouter.patch("/users/:id/status", async (req, res): Promise<void> => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const userId = req.params.id;
    const status = req.body?.status;

    if (!ObjectId.isValid(userId)) {
      res.status(400).json({
        success: false,
        message: "Invalid user ID.",
      });
      return;
    }

    if (!["Banned", "Active"].includes(status)) {
      res.status(400).json({
        success: false,
        message: "Status must be Banned or Active.",
      });
      return;
    }

    const users = database.collection("user");
    const targetUser = await users.findOne({
      _id: new ObjectId(userId),
    });

    if (!targetUser) {
      res.status(404).json({
        success: false,
        message: "User not found.",
      });
      return;
    }

    if (targetUser.role === "admin") {
      res.status(403).json({
        success: false,
        message: "Admin accounts cannot be blocked here.",
      });
      return;
    }

    const headers = fromNodeHeaders(req.headers);

    if (status === "Banned") {
      await auth.api.banUser({
        body: {
          userId,
          banReason: "Blocked by SalonBook admin.",
        },
        headers,
      });
    } else {
      await auth.api.unbanUser({
        body: { userId },
        headers,
      });
    }

    res.json({
      success: true,
      message:
        status === "Banned"
          ? "User blocked successfully."
          : "User unblocked successfully.",
    });
  } catch (error) {
    console.error("Could not update user status:", error);
    res.status(500).json({
      success: false,
      message: "Could not update user status.",
    });
  }
});


adminRouter.get("/transactions", async (_req, res): Promise<void> => {
  try {
    if (!(await requireAdmin(_req, res))) return;
    const transactions = await database
      .collection("transactions")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      count: transactions.length,
      transactions: transactions.map((transaction) => ({
        ...transaction,
        _id: transaction._id.toString(),
      })),
    });
  } catch (error) {
    console.error("Could not load transactions:", error);

    res.status(500).json({
      success: false,
      message: "Could not load transactions.",
    });
  }
});
const DEFAULT_OFFER_SETTINGS = {
  title: "Friday & Monday Special",
  message:
    "Offers may be changed or updated by the salon management at any time.",
  discountPercent: 47,
  activeDays: ["Friday", "Monday"],
  categories: ["Skin Care", "Hair Treatment", "Spa & Massage"],
  isActive: true,
};

const OFFER_SETTINGS_ID = "salonbook-weekly-offer";

adminRouter.get("/offer-settings", async (req, res): Promise<void> => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const savedOffer = await database
      .collection("offerSettings")
      .findOne({ _id: OFFER_SETTINGS_ID } as any);

    res.json({
      success: true,
      offer: savedOffer
        ? { ...DEFAULT_OFFER_SETTINGS, ...savedOffer }
        : DEFAULT_OFFER_SETTINGS,
    });
  } catch (error) {
    console.error("Could not load offer settings:", error);
    res.status(500).json({
      success: false,
      message: "Could not load offer settings.",
    });
  }
});

adminRouter.patch("/offer-settings", async (req, res): Promise<void> => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const body = req.body ?? {};
    const title =
      typeof body.title === "string" ? body.title.trim() : "";
    const message =
      typeof body.message === "string" ? body.message.trim() : "";
    const discountPercent = Number(body.discountPercent);
    const activeDays = Array.isArray(body.activeDays)
      ? body.activeDays.filter(
          (day: unknown): day is string =>
            typeof day === "string" &&
            ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].includes(day)
        )
      : [];
    const categories = Array.isArray(body.categories)
      ? body.categories
          .filter(
            (category: unknown): category is string =>
              typeof category === "string" && category.trim().length > 0
          )
          .map((category: string) => category.trim())
      : [];
    const isActive = body.isActive;

    if (
      !title ||
      title.length > 100 ||
      !message ||
      message.length > 300 ||
      !Number.isInteger(discountPercent) ||
      discountPercent < 1 ||
      discountPercent > 100 ||
      typeof isActive !== "boolean" ||
      activeDays.length === 0 ||
      categories.length === 0
    ) {
      res.status(400).json({
        success: false,
        message:
          "Provide a title, message, discount from 1 to 100, at least one active day and category, and an active status.",
      });
      return;
    }

    const now = new Date();
    const offer = {
      title,
      message,
      discountPercent,
      activeDays: [...new Set(activeDays)],
      categories: [...new Set(categories)],
      isActive,
      updatedAt: now,
    };

    await database.collection("offerSettings").updateOne(
      { _id: OFFER_SETTINGS_ID } as any,
      {
        $set: offer,
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    res.json({
      success: true,
      message: "Offer settings saved successfully.",
      offer,
    });
  } catch (error) {
    console.error("Could not save offer settings:", error);
    res.status(500).json({
      success: false,
      message: "Could not save offer settings.",
    });
  }
});
export default adminRouter;






