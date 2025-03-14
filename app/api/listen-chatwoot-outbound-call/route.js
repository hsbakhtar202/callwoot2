import { NextResponse } from 'next/server';
import axios from 'axios';

// Constants
const ACTIVE_CALL_TIMEOUT = 10000; // 10 seconds in milliseconds

// Store to track recent outbound calls with timestamps
const activeCalls = new Map(); // Map<string, { timestamp: number, timeoutId: NodeJS.Timeout }>
const sentLinks = new Map(); // Store to track sent meeting links

// Helper function to manage active calls
function addActiveCall(customerNumber) {
  // Clear any existing timeout for this number if it exists
  if (activeCalls.has(customerNumber)) {
    const existing = activeCalls.get(customerNumber);
    clearTimeout(existing.timeoutId);
  }

  // Set new timeout and store both timestamp and timeout ID
  const timestamp = Date.now();
  const timeoutId = setTimeout(() => {
    if (activeCalls.has(customerNumber)) {
      const call = activeCalls.get(customerNumber);
      // Only delete if this is the same timestamp (no new call has been made)
      if (call.timestamp === timestamp) {
        activeCalls.delete(customerNumber);
        console.log(`Removed ${customerNumber} from active calls after timeout`);
      }
    }
  }, ACTIVE_CALL_TIMEOUT);

  // Store both timestamp and timeout ID
  activeCalls.set(customerNumber, { timestamp, timeoutId });
  console.log(`Added ${customerNumber} to active calls, will be removed in 10 seconds`);
}

// Helper function to check if a call is active
function isCallActive(customerNumber) {
  if (!activeCalls.has(customerNumber)) return false;

  const call = activeCalls.get(customerNumber);
  const elapsed = Date.now() - call.timestamp;

  // If the call has expired but hasn't been cleaned up yet, clean it up now
  if (elapsed >= ACTIVE_CALL_TIMEOUT) {
    clearTimeout(call.timeoutId);
    activeCalls.delete(customerNumber);
    return false;
  }

  return true;
}

// Helper function to remove active call immediately
function removeActiveCall(customerNumber) {
  if (activeCalls.has(customerNumber)) {
    const call = activeCalls.get(customerNumber);
    clearTimeout(call.timeoutId);
    activeCalls.delete(customerNumber);
    console.log(`Removed ${customerNumber} from active calls immediately`);
  }
}

export async function POST(request) {
  try {
    const requestBody = await request.json();
    let { message_type, content_attributes } = requestBody;

    // Check if the message contains a Dyte meeting link
    if (
      message_type === "outgoing" &&
      content_attributes &&
      content_attributes.type === 'dyte' &&
      content_attributes.data &&
      content_attributes.data.meeting_id
    ) {

      let conversation_id;

      if (requestBody && requestBody.conversation && requestBody.conversation.id) {
        conversation_id = requestBody.conversation.id;
      }

      if (!conversation_id) {
        console.log('conversation id not found, quiting');
        return NextResponse.json({ success: false, message: 'conversation id not found' }, { status: 400 });
      }

      const agentName = requestBody.sender.name;
      const agentId = requestBody.sender.id;
      let customerNumber;

      // Fetch customer contact information from Chatwoot
      try {
        const chatwootContactResponse = await axios.get(
          `${process.env.CHATWOOT_INSTANCE_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/conversations/${conversation_id}`,
          { headers: { api_access_token: process.env.CHATWOOT_ACCESS_TOKEN } }
        );
        if (chatwootContactResponse.data) {
          customerNumber = chatwootContactResponse.data.meta.sender.phone_number;
        }
      } catch (error) {
        logAxiosError("Error fetching customer contact", error);
      }

      if (!customerNumber) {
        console.log('No customer number found, aborting.');
        return NextResponse.json({ success: false, message: 'No customer number found' }, { status: 400 });
      }

      // Prevent duplicate call initiation using the enhanced check
      if (isCallActive(customerNumber)) {
        console.log('Outbound call already in progress for this customer, skipping.');
        return NextResponse.json({ success: false, message: 'Outbound call already in progress' }, { status: 409 });
      }

      // Create Dyte meeting
      const { meetingId, dyteMeetingLink } = await createDyteMeeting(customerNumber, agentName, agentId, conversation_id);

      if (!dyteMeetingLink) {
        console.log('Failed to create meeting link.');
        return NextResponse.json({ success: false, message: 'Failed to create meeting link' }, { status: 500 });
      }

      // Add to active calls with enhanced management
      addActiveCall(customerNumber);

      try {
        const webhookUrl = `${process.env.SERVER_URL}/api/dyte-agent-joined-outbound-call?customerNumber=${encodeURIComponent(
          customerNumber
        )}&conversationId=${encodeURIComponent(conversation_id)}&meetingId=${encodeURIComponent(meetingId)}`;

        await axios.post(
          `https://api.dyte.io/v2/webhooks`,
          {
            name: `${agentName} created outbound call webhook for ${customerNumber}`,
            events: ["meeting.participantJoined"],
            url: webhookUrl,
          },
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`${process.env.DYTE_ORG_ID}:${process.env.DYTE_API_KEY}`).toString(
                "base64"
              )}`,
              "Content-Type": "application/json",
            },
          }
        );

        console.log("Dyte webhook registered successfully.");
        return NextResponse.json({ success: true, message: "Dyte webhook registered, waiting for agent to join." });
      } catch (error) {
        console.log("Failed to register Dyte webhook.");
        removeActiveCall(customerNumber); // Use the new helper function for immediate removal
        logAxiosError("Error registering Dyte webhook", error);
        return NextResponse.json({ success: false, message: "Failed to register Dyte webhook" }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, message: 'Call initiation process started.' });
  } catch (error) {
    console.log('Error processing Chatwoot webhook:', error);
    return NextResponse.json({ success: false, error: 'Failed to process webhook' }, { status: 500 });
  }
}

// Create Dyte meeting
async function createDyteMeeting(fromNumber, agentName, agentId, conversation_id) {
  try {
    const encodedCredentials = Buffer.from(`${process.env.DYTE_ORG_ID}:${process.env.DYTE_API_KEY}`).toString('base64');

    const dyteResponse = await axios.post(
      `https://api.dyte.io/v2/meetings`,
      {
        title: `Outbound call to ${fromNumber}`,
        preferred_region: "us-east-1",
        record_on_start: false,
        live_stream_on_start: false
      },
      {
        headers: {
          Authorization: `Basic ${encodedCredentials}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const meetingId = dyteResponse.data.data.id;
    const authToken = await addParticipantToMeeting(meetingId, agentName, agentId, encodedCredentials);
    const dyteMeetingLink = authToken ? `https://app.dyte.io/v2/meeting?id=${meetingId}&authToken=${authToken}` : null;

    if (dyteMeetingLink) {
      // Check if the link has already been sent for this conversation
      if (!sentLinks.has(conversation_id)) {
        const meetingLinkSent = await sendMeetingLinkToAgent(dyteMeetingLink, conversation_id);
        if (meetingLinkSent) {
          console.log('Meeting link sent to agent');
          sentLinks.set(conversation_id, true); // Track sent link
          setTimeout(() => sentLinks.delete(conversation_id), 100000); // Clear entry after 10 seconds
        } else {
          console.log('Failed to send meeting link to agent');
        }
      } else {
        console.log('Meeting link already sent for this conversation, skipping.');
      }
    }

    return { meetingId, dyteMeetingLink };
  } catch (error) {
    logAxiosError("Error creating Dyte meeting", error);
    return { error: 'Failed to create meeting' };
  }
}

// Add participant to Dyte meeting
async function addParticipantToMeeting(meetingId, agentName, agentId, encodedCredentials) {
  try {
    const response = await axios.post(
      `https://api.dyte.io/v2/meetings/${meetingId}/participants`,
      {
        name: String(agentName),
        preset_name: "group_call_host",
        custom_participant_id: String(agentId)
      },
      {
        headers: {
          Authorization: `Basic ${encodedCredentials}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.data.token;
  } catch (error) {
    logAxiosError("Error adding participant", error);
    return null;
  }
}

// Send meeting link to agent in conversation
async function sendMeetingLinkToAgent(dyteMeetingLink, conversationId) {
  try {
    await axios.post(
      `${process.env.CHATWOOT_INSTANCE_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
      {
        content: `**[Join the call here](${dyteMeetingLink})**`,
        message_type: 'outgoing',
        private: true
      },
      { headers: { api_access_token: process.env.CHATWOOT_ACCESS_TOKEN } }
    );
    return true;
  } catch (error) {
    logAxiosError("Error sending meeting link to agent", error);
    return false;
  }
}

// Helper to log axios errors
function logAxiosError(context, error) {
  if (error.response) {
    console.log(`${context} - Response error:`, error.response.data);
  } else if (error.request) {
    console.log(`${context} - No response received:`, error.request);
  } else {
    console.log(`${context} - Error message:`, error.message);
  }
}
