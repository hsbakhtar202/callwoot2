# Receive Calls on Chatwoot using Twilio and Dyte

This project enables you to receive calls in Chatwoot using Twilio and Dyte.

## Setup Instructions

1. **Update Environment Variables** 
   Modify the `.env` file with your own configuration data to integrate Twilio and Dyte with Chatwoot.

2. **Update Webhook URLs in Twilio**
   Update the Twilio webhook URLs to point to your own domain/server. This will allow Twilio to send call events to your domain/server.
   You can configure this in the [Twilio Console](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming/PN0984bc05b5998176684aa8f8dd8df7b6/configure).

3. **Update Chatwoot Webhook**
   Update the Chatwoot webhook URL to point to your own domain/server. This will allow Chatwoot to send outbound call events to your domain/server.