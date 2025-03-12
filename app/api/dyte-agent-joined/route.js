// dyte-agent-joined

import { deleteWebhook, fetchWebhooks } from '@/lib/callHandler';
import { NextResponse } from 'next/server';
import twilio from 'twilio';

// In-memory store for call SIDs
const callSidStore = new Map();

// Helper function to clean up expired SIDs
function cleanUpExpiredSids() {
  const currentTime = Date.now();
  for (const [callSid, timestamp] of callSidStore) {
    if (currentTime - timestamp > 10000) {  // 10 seconds threshold
      callSidStore.delete(callSid);
    }
  }
}

// Periodically clean up expired SIDs every 3 seconds
setInterval(cleanUpExpiredSids, 3000);

export async function POST(req) {
  try {
    // Extract the conversationId and callSid from query parameters
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get('conversationId');
    const callSid = searchParams.get('callSid');
    // console.log("Extracted conversationId and callSid: ", conversationId, callSid);

    // Check if the callSid has already been processed in the last 10 seconds
    if (callSidStore.has(callSid)) {
      console.log(`Duplicate callSid: ${callSid} detected. Rejecting request.`);
      return NextResponse.json({ error: 'Duplicate callSid. Please wait.' }, { status: 400 });
    }

    // Store the callSid with the current timestamp
    callSidStore.set(callSid, Date.now());

    // Parse the request body and extract event and participant
    const body = await req.json();
    const { event, participant } = body || {}; // Separate event and participant
    // console.log("Event:", event);
    // console.log("Participant:", participant);

    // Validate extracted fields
    if (!event || !participant) {
      throw new Error("Missing required event or participant data in request body.");
    }

    // Check if the participant is the agent (adjust condition as needed)
    if (event === "meeting.participantJoined") {
      // Fetch all webhooks and delete the one with the matching conversationId
      const webhooks = await fetchWebhooks();
      // console.log("Webhooks:", JSON.stringify(webhooks, null, 2));
      const webhookToDelete = webhooks.data.find(webhook => webhook.url === `${process.env.SERVER_URL}/api/dyte-agent-joined?conversationId=${conversationId}`);

      if (webhookToDelete) {
        await deleteWebhook(webhookToDelete.id);
        console.log(`Deleted webhook with conversationId: ${conversationId}`);
      }

      const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      // console.log("Agent detected. Starting call recording.");

      // Delay for 3 seconds before starting the recording
      setTimeout(async () => {
        try {
          // Check the status of the call before recording
          const callDetails = await twilioClient.calls(callSid).fetch();

          if (callDetails.status === 'in-progress') {
            const recording = await twilioClient.calls(callSid).recordings.create({
              recordingStatusCallback: `${process.env.SERVER_URL}/api/recording-status?conversationId=${conversationId}`,
              recordingStatusCallbackEvent: ["completed"],
            });
            console.log("Recording created successfully:", recording.sid);
          } else {
            console.log(`Call with SID ${callSid} is not in progress. Current status: ${callDetails.status}`);
          }
        } catch (error) {
          console.log("Error creating recording:", error);
        }
      }, 3000);

    } else {
      console.log("Event mismatch.");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error handling Dyte agent join webhook:", error);
    return NextResponse.json({ error: 'Failed to process webhook' }, { status: 500 });
  }
}
