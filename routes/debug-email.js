// routes/debug-email.js
import { Router } from "express";
import { sendEmail } from "../utils/sendEmail.js";

const router = Router();

router.get("/email-test", async (req, res) => {
  try {
    const to = process.env.SMTP_USER; // send test mail to yourself
    await sendEmail({
      to,
      subject: "SMTP Test",
      text: "This is a plain text test email.",
      html: "<p>This is a <b>test</b> email.</p>",
    });
    res.json({ ok: true, message: "Test email sent to " + to });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: e?.message || String(e) });
  }
});

export default router;
