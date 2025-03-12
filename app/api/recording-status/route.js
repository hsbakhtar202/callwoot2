import { NextResponse } from 'next/server';
import axios from 'axios';

export async function POST(req) {
  console.log('Recording request received');

  let body;
  try {
    const rawBody = await req.text();
    body = Object.fromEntries(new URLSearchParams(rawBody));
    // console.log('Parsed body:', body);
  } catch (error) {
    console.log('Error parsing request body:', error);
    return NextResponse.json({ error: 'Failed to parse request body' }, { status: 400 });
  }

  let conversationId;
  try {
    conversationId = new URL(req.url).searchParams.get('conversationId');
  } catch (error) {
    console.log('Error retrieving conversation ID from query parameters:', error);
    return NextResponse.json({ error: 'Failed to retrieve conversation ID' }, { status: 400 });
  }

  const { RecordingUrl, CallSid, RecordingDuration } = body;

  if (!RecordingUrl || !conversationId) {
    console.log("Missing RecordingUrl or conversationId in request.");
    return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
  }

  try {
    const saved = await saveRecordingToChatwoot(RecordingUrl, RecordingDuration, conversationId);
    return NextResponse.json({ success: saved });
  } catch (error) {
    console.log('Error saving recording to Chatwoot:', error);
    return NextResponse.json({ error: 'Failed to save recording' }, { status: 500 });
  }
}

async function saveRecordingToChatwoot(recordingUrl, RecordingDuration, conversationId) {
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 3000;

  // Convert RecordingDuration from seconds to hh:mm:ss format
  const totalSeconds = parseInt(RecordingDuration, 10);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  // Format to hh:mm:ss
  const formattedDuration = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await axios.post(
        `${process.env.CHATWOOT_INSTANCE_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
        {
          content: `**Call recording: [Download Recording](${recordingUrl})\nDuration: ${formattedDuration}**`,
          message_type: 'outgoing',
          private: true,
        },
        { headers: { api_access_token: process.env.CHATWOOT_ACCESS_TOKEN } }
      );
      console.log("Recording successfully saved on attempt", attempt);
      return true;
    } catch (error) {
      console.log(`Attempt ${attempt} failed:`, error);
      if (attempt < MAX_RETRIES) {
        console.log(`Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  console.log('All attempts to save recording failed.');
  return false;
}
