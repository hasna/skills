#!/usr/bin/env bun
/**
 * Script to buy a Twilio phone number for an agent
 * Usage: bun run scripts/buy-number.ts [agent_name] [area_code]
 */

import twilio from "twilio";

const CONFIG = {
  accountSid: process.env.TWILIO_ACCOUNT_SID || "",
  authToken: process.env.TWILIO_AUTH_TOKEN || "",
};

const twilioClient = twilio(CONFIG.accountSid, CONFIG.authToken);

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

async function buyPhoneNumber() {
  const agentName = process.argv[2] || "claude";
  const areaCode = process.argv[3] || "302"; // Default to Delaware

  const friendlyName = `${capitalize(agentName)} (AI Agent)`;

  console.log(`Searching for available numbers with area code ${areaCode}...`);

  try {
    // Search for available numbers
    const availableNumbers = await twilioClient
      .availablePhoneNumbers("US")
      .local.list({ areaCode: parseInt(areaCode), limit: 5 });

    if (availableNumbers.length === 0) {
      console.error(`No available phone numbers found with area code ${areaCode}`);
      process.exit(1);
    }

    console.log(`Found ${availableNumbers.length} available numbers:`);
    availableNumbers.forEach((n, i) => {
      console.log(`  ${i + 1}. ${n.phoneNumber}`);
    });

    // Purchase the first available number
    const phoneNumber = availableNumbers[0].phoneNumber;
    console.log(`\nPurchasing ${phoneNumber} for ${friendlyName}...`);

    const purchased = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber,
      friendlyName,
    });

    console.log("\nPhone number purchased successfully!");
    console.log(`  SID: ${purchased.sid}`);
    console.log(`  Phone Number: ${purchased.phoneNumber}`);
    console.log(`  Friendly Name: ${purchased.friendlyName}`);
  } catch (error: any) {
    console.error("Failed to buy phone number:", error.message);
    process.exit(1);
  }
}

buyPhoneNumber();
