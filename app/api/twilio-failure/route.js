import { NextResponse } from 'next/server'
import twilio from 'twilio'

export async function POST(req) {
  console.log('Failure webhook triggered')

  try {
    // Parse the raw body
    const rawBody = await req.text()
    const body = Object.fromEntries(new URLSearchParams(rawBody))

    console.log('Parsed failure body:', body)

    // Validate the request is from Twilio
    const twilioSignature = req.headers.get('x-twilio-signature')
    const url = `${process.env.SERVER_URL}/api/twilio-failure`

    const requestIsValid = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      twilioSignature,
      url,
      body
    )

    if (!requestIsValid) {
      console.log('Invalid Twilio signature for failure webhook')
      return new NextResponse('Invalid signature', { status: 403 })
    }

    // Log the failure details
    const {
      CallSid,
      CallStatus,
      ErrorCode,
      ErrorUrl,
      ErrorMessage,
      From,
      To
    } = body

    console.log('Call failure details:', {
      CallSid,
      CallStatus,
      ErrorCode,
      ErrorUrl,
      ErrorMessage,
      From,
      To
    })

    // Respond to Twilio
    const twiml = new twilio.twiml.VoiceResponse()
    twiml.say('We apologize, but there was an issue processing your call. Please try again later.')

    return new NextResponse(twiml.toString(), {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  } catch (error) {
    console.log('Error in failure webhook:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
