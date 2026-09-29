import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const SES_REGION = process.env.SES_REGION;
const MAIL_FROM = process.env.MAIL_FROM;
// SES accounts start at 14 emails/second in production (1/s in the sandbox).
const RATE_PER_SECOND = Math.max(1, Number(process.env.MAIL_RATE_PER_SECOND ?? 10));

// Credentials come from the default AWS chain: the EC2 instance role in production,
// or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY if set.
const client = SES_REGION ? new SESv2Client({ region: SES_REGION }) : null;

// Local development: MAIL_TRANSPORT=log turns on the email flows but prints messages instead of sending.
const LOG_ONLY = process.env.MAIL_TRANSPORT === "log";

/** True when email flows (invites, reset links, notifications) are active. */
export function isEmailEnabled(): boolean {
  return LOG_ONLY || Boolean(client && MAIL_FROM);
}

/** Public base URL of the web app, used for links inside emails. */
export function appUrl(path = ""): string {
  const base = (process.env.APP_URL ?? process.env.CORS_ORIGIN?.split(",")[0] ?? "http://localhost:3000").trim().replace(/\/$/, "");
  return `${base}${path}`;
}

async function deliver(message: MailMessage): Promise<void> {
  if (LOG_ONLY || !client || !MAIL_FROM) {
    console.log(`[mail] to=${message.to} subject="${message.subject}"\n${message.text}\n`);
    return;
  }
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: MAIL_FROM,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: message.html, Charset: "UTF-8" },
            Text: { Data: message.text, Charset: "UTF-8" },
          },
        },
      },
    }),
  );
}

// In-process queue: callers never wait on SES, and bursts (announcements, payroll)
// are spread out to stay under the account's sending rate.
const queue: MailMessage[] = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const batch = queue.splice(0, RATE_PER_SECOND);
      const started = Date.now();
      await Promise.all(
        batch.map((m) =>
          deliver(m).catch((err) => console.error(`Failed to send email to ${m.to} ("${m.subject}")`, err)),
        ),
      );
      const elapsed = Date.now() - started;
      if (queue.length && elapsed < 1000) await new Promise((r) => setTimeout(r, 1000 - elapsed));
    }
  } finally {
    draining = false;
  }
}

/** Queues an email for delivery. Never throws: a failed email must not fail the request that caused it. */
export function sendMail(message: MailMessage | MailMessage[]): void {
  const messages = (Array.isArray(message) ? message : [message]).filter((m) => m.to);
  if (!messages.length) return;
  queue.push(...messages);
  void drain();
}
