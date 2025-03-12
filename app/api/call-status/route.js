import { NextResponse } from 'next/server';
import axios from 'axios';
import twilio from 'twilio';

export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');
    const meetingId = searchParams.get('meetingId');
    const body = Object.fromEntries(new URLSearchParams(await request.text()));

    const { CallStatus, RecordingUrl, CallSid, RecordingDuration } = body;

    console.log('Received call status:', CallStatus, 'for CallSid:', CallSid, 'RecordingUrl:', RecordingUrl, 'RecordingDuration:', RecordingDuration);

    if (!conversationId || !CallSid) {
      console.log('Missing conversationId or CallSid');
      return NextResponse.json({ success: false, error: 'Missing conversationId or CallSid' }, { status: 400 });
    }

    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    // Determine call status and prepare message content
    let messageContent = '';

    switch (CallStatus) {
      case 'initiated':
        messageContent = 'Twilio has dialed the call';
        break;
      case 'ringing':
        messageContent = 'The destination number has started ringing';
        break;
      case 'in-progress':
        messageContent = 'The call has been connected and is currently active';

        try {
          const recording = await twilioClient.calls(CallSid).recordings.create({
            recordingStatusCallback: `${process.env.SERVER_URL}/api/recording-status?conversationId=${conversationId}`,
            recordingStatusCallbackEvent: ["completed"],
          });
          console.log("Recording created successfully:", recording.sid);
        } catch (error) {
          console.log("Error creating recording:", error);
        }

        break;
      case 'busy':
        messageContent = 'Twilio dialed the number but received a busy response';
        break;
      case 'no-answer':
        messageContent = 'Twilio dialed the number but no one answered before the timeout';
        break;
      case 'canceled':
        messageContent = 'Twilio call was canceled';
        break;
      case 'completed':
        messageContent = 'Outbound call ended.';
        break;
      case 'failed':
        messageContent = 'Call failed';
        break;
      default:
        messageContent = 'Unknown call status';
    }

    console.log(messageContent);

    // Send message to Chatwoot conversation
    try {
      await axios.post(
        `${process.env.CHATWOOT_INSTANCE_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
        {
          content: messageContent,
          message_type: 'outgoing',
          private: true
        },
        { headers: { api_access_token: process.env.CHATWOOT_ACCESS_TOKEN } }
      );
      console.log('Message sent to Chatwoot successfully');
    } catch (chatwootError) {
      console.log('Error sending message to Chatwoot:', chatwootError.response ? chatwootError.response.data : chatwootError.message);
    }

    // If the call was completed, send the recording URL to recording-status endpoint
    if (CallStatus === 'completed' && RecordingUrl) {
      try {
        await axios.post(
          `${process.env.SERVER_URL}/api/recording-status?conversationId=${conversationId}`,
          { RecordingUrl, CallSid, RecordingDuration },
          { headers: { 'Content-Type': 'application/json' } }
        );
        console.log('Recording status sent successfully');
      } catch (recordingStatusError) {
        console.log('Error sending recording status:', recordingStatusError.response ? recordingStatusError.response.data : recordingStatusError.message);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log('Error handling Twilio status callback:', error);
    return NextResponse.json({ success: false, error: 'Failed to handle status callback' }, { status: 500 });
  }
}
