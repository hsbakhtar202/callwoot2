// connect-outbound-call-to-meeting

import { NextResponse } from 'next/server';
import twilio from 'twilio';

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('conversationId');
  const meetingId = searchParams.get('meetingId');
  const customerNumber = searchParams.get('customerNumber');

  const twiml = new twilio.twiml.VoiceResponse();
  // twiml.say("Connecting you to the meeting. Please hold.");
  
  const dial = twiml.dial();
    dial.sip(
      {
        username: process.env.DYTE_SIP_USERNAME,
        password: process.env.DYTE_SIP_PASSWORD,
      },
      `sip:${meetingId}@sip.dyte.io`
  );

  return new Response(twiml.toString(), { headers: { 'Content-Type': 'text/xml' } });
}
