import { NextResponse } from 'next/server';
import twilio from 'twilio';

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function POST(req, res) {
  try {
    const { customerNumber, conversationId, meetingId } = await req.json();

    // Make an outbound call to the customer's phone number
    const call = await twilioClient.calls.create({
      to: customerNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${process.env.SERVER_URL}/api/connect-outbound-call-to-meeting?conversationId=${conversationId}&meetingId=${meetingId}&customerNumber=${customerNumber}`, // Webhook for SIP connection
      statusCallback: `${process.env.SERVER_URL}/api/call-status?conversationId=${conversationId}&meetingId=${meetingId}`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });

    console.log("Initial call to customer initiated:", call.sid);

    return NextResponse.json({ success: true, callSid: call.sid, message: 'Call initiated successfully' });
  } catch (error) {
    console.log('Error initiating call:', error);
    return NextResponse.json({ success: false, error: 'Failed to initiate call' }, { status: 500 });
  }
}
