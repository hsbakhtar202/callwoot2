import { NextResponse } from "next/server";
import axios from "axios";
import { deleteWebhook, fetchWebhooks } from "@/lib/callHandler";

const recentCalls = new Map(); // Store to track recent calls and prevent duplicates

export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerNumber = searchParams.get("customerNumber");
    const conversationId = searchParams.get("conversationId");
    const meetingId = searchParams.get("meetingId");

    if (!customerNumber || !conversationId || !meetingId) {
      return NextResponse.json({ success: false, message: "Missing required parameters" }, { status: 400 });
    }

    // Prevent duplicate call initiation within 1 minute
    if (recentCalls.has(customerNumber)) {
      console.log(`Call already initiated for ${customerNumber}. Skipping duplicate call.`);
      return NextResponse.json({ success: false, message: "Call already initiated recently" }, { status: 409 });
    }

    console.log(`Agent joined Dyte meeting. Initiating call for ${customerNumber}`);

    // Store call initiation to prevent duplicates
    recentCalls.set(customerNumber, true);
    setTimeout(() => recentCalls.delete(customerNumber), 60000); // Remove after 1 minute

    // Now, we initiate the outbound call
    const callInitiationResponse = await axios.post(
      `${process.env.SERVER_URL}/api/initiate-outbound-call`,
      { customerNumber, conversationId, meetingId },
      { headers: { "Content-Type": "application/json" } }
    );

    if (callInitiationResponse.data.success) {
      console.log("Call initiation process started");

      // Delete the Dyte webhook after successful call initiation
      await removeDyteWebhook(conversationId);

      return NextResponse.json({ success: true, message: "Call initiation process started" });
    } else {
      console.log("Failed to start call initiation");
      recentCalls.delete(customerNumber); // Remove immediately if call initiation fails
      return NextResponse.json({ success: false, message: "Failed to start call initiation" }, { status: 500 });
    }
  } catch (error) {
    console.log("Error handling Dyte webhook:", error);
    return NextResponse.json({ success: false, message: "Error handling Dyte webhook" }, { status: 500 });
  }
}

// Function to find and delete the Dyte webhook
async function removeDyteWebhook(conversationId) {
  try {
    const webhooks = await fetchWebhooks();

    if (!webhooks.success || !webhooks.data) {
      console.log("Failed to fetch Dyte webhooks");
      return;
    }

    // Find webhook matching our specific conversation
    const webhookToDelete = webhooks.data.find(webhook =>
      webhook.url.startsWith(`${process.env.SERVER_URL}/api/dyte-agent-joined-outbound-call`) &&
      webhook.url.includes(`conversationId=${conversationId}`)
    );

    if (webhookToDelete) {
      await deleteWebhook(webhookToDelete.id);
      console.log(`Deleted Dyte webhook for conversationId: ${conversationId}`);
    } else {
      console.log(`No matching webhook found for conversationId: ${conversationId}`);
    }
  } catch (error) {
    console.log("Error deleting Dyte webhook:", error);
  }
}