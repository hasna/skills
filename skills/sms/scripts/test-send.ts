#!/usr/bin/env bun
/**
 * Test script to send SMS via Twilio
 * Usage: bun run scripts/test-send.ts [from_number] [to_number] [message]
 */

import twilio from "twilio";

const CONFIG = {
  accountSid: process.env.TWILIO_ACCOUNT_SID || "",
  authToken: process.env.TWILIO_AUTH_TOKEN || "",
};

const twilioClient = twilio(CONFIG.accountSid, CONFIG.authToken);

function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (!phone.startsWith("+")) {
    return `+${digits}`;
  }
  return phone;
}

async function sendTestSms() {
  const fromNumber = process.argv[2];
  const toNumber = process.argv[3];
  const messageBody =
    process.argv[4] ||
    `Hello from the SMS agent!\n\nThis is a test SMS sent at ${new Date().toISOString()}.`;

  if (!fromNumber || !toNumber) {
    console.error("Usage: bun run scripts/test-send.ts <from_number> <to_number> [message]");
    console.error("\nAvailable numbers:");
    const numbers = await twilioClient.incomingPhoneNumbers.list();
    numbers.forEach((n) => {
      console.log(`  ${n.phoneNumber} - ${n.friendlyName}`);
    });
    process.exit(1);
  }

  console.log(`Sending test SMS from ${formatPhoneNumber(fromNumber)} to ${formatPhoneNumber(toNumber)}...`);

  try {
    const message = await twilioClient.messages.create({
      body: messageBody,
      from: formatPhoneNumber(fromNumber),
      to: formatPhoneNumber(toNumber),
    });

    console.log("SMS sent successfully!");
    console.log(`  Message SID: ${message.sid}`);
    console.log(`  Status: ${message.status}`);
    console.log(`  From: ${message.from}`);
    console.log(`  To: ${message.to}`);
  } catch (error: any) {
    console.error("Failed to send SMS:", error.message);
    process.exit(1);
  }
}

sendTestSms();
