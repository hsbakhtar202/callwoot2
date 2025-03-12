import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { handleInboundCall } from '../../../lib/callHandler'

export async function POST(req) {

  const twiml = new twilio.twiml.VoiceResponse()

  try {
    const rawBody = await req.text()
    // console.log('Raw request body:', rawBody)

    const body = Object.fromEntries(new URLSearchParams(rawBody))
    // console.log('Parsed body:', body)

    const twilioSignature = req.headers.get('x-twilio-signature')
    const url = process.env.WEBHOOK_URL

    const requestIsValid = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      twilioSignature,
      url,
      body
    )

    if (!requestIsValid) {
      console.log('Invalid Twilio signature')
      twiml.say('We apologize, but there was an issue processing your call. Please try again later.')
      return new NextResponse(twiml.toString(), {
        status: 403,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    console.log('Request validation passed')
    await handleInboundCall(body, twiml)
  } catch (error) {
    console.log('Error handling inbound call:', error)
    twiml.say('We are unable to process your call at the moment. Please try again later.')
  }

  const response = twiml.toString()
  console.log('Sending TwiML response:', response)

  return new NextResponse(response, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}