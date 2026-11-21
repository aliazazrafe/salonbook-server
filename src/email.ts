type AppointmentEmailStatus = "Pending" | "Confirmed" | "Cancelled";

type AppointmentEmailInput = {
  email?: unknown;
  name?: unknown;
  service?: unknown;
  barberName?: unknown;
  date?: unknown;
  time?: unknown;
  status: AppointmentEmailStatus;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character] || character;
  });
}

export async function sendAppointmentEmail(
  appointment: AppointmentEmailInput
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const to =
    typeof appointment.email === "string" ? appointment.email.trim() : "";

  if (!apiKey || !from) {
    console.warn(
      "[email] Email skipped: set RESEND_API_KEY and EMAIL_FROM in server .env."
    );
    return;
  }

  if (!to) {
    console.warn("[email] Email skipped: appointment has no email address.");
    return;
  }

  const subjects: Record<AppointmentEmailStatus, string> = {
    Pending: "Appointment request received - SalonBook",
    Confirmed: "Your appointment is confirmed - SalonBook",
    Cancelled: "Your appointment was cancelled - SalonBook",
  };

  const headings: Record<AppointmentEmailStatus, string> = {
    Pending: "Appointment request received",
    Confirmed: "Your appointment is confirmed",
    Cancelled: "Your appointment was cancelled",
  };

  const descriptions: Record<AppointmentEmailStatus, string> = {
    Pending: "We received your appointment request. It is waiting for salon confirmation.",
    Confirmed: "Your salon appointment has been confirmed.",
    Cancelled: "Your salon appointment has been cancelled.",
  };

  const customerName =
    typeof appointment.name === "string" ? appointment.name : "Customer";
  const service =
    typeof appointment.service === "string" ? appointment.service : "Salon service";
  const barberName =
    typeof appointment.barberName === "string"
      ? appointment.barberName
      : "Your selected barber";
  const date = typeof appointment.date === "string" ? appointment.date : "";
  const time = typeof appointment.time === "string" ? appointment.time : "";

  const safeName = escapeHtml(customerName);
  const safeService = escapeHtml(service);
  const safeBarber = escapeHtml(barberName);
  const safeDate = escapeHtml(date);
  const safeTime = escapeHtml(time);
  const safeDescription = escapeHtml(descriptions[appointment.status]);

  const text = [
    "SalonBook",
    "",
    "Hello " + customerName + ",",
    descriptions[appointment.status],
    "",
    "Service: " + service,
    "Barber: " + barberName,
    "Date: " + date,
    "Time: " + time,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#222;max-width:600px;margin:auto;padding:24px">
      <h1 style="color:#647548">SalonBook</h1>
      <h2>${headings[appointment.status]}</h2>
      <p>Hello ${safeName},</p>
      <p>${safeDescription}</p>
      <div style="background:#f5f5f0;padding:16px;border-radius:10px">
        <p><strong>Service:</strong> ${safeService}</p>
        <p><strong>Barber:</strong> ${safeBarber}</p>
        <p><strong>Date:</strong> ${safeDate}</p>
        <p><strong>Time:</strong> ${safeTime}</p>
      </div>
      <p>Thank you for choosing SalonBook.</p>
    </div>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: subjects[appointment.status],
        html,
        text,
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      console.error("[email] Resend request failed:", response.status, details);
      return;
    }

    console.log("[email] Appointment email sent.");
  } catch (error) {
    console.error("[email] Could not send appointment email:", error);
  }
}
