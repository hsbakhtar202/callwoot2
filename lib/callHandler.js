import axios from 'axios';

export async function handleInboundCall(body, twiml) {
  const fromNumber = body.From;
  const callSid = body.CallSid;

  if (!fromNumber) {
    console.log('From number is missing');
    throw new Error('From number is missing');
  }

  console.log(`Incoming call from: ${fromNumber}`);

  twiml.say("Thank you for calling. This call may be recorded to improve the quality of our service.");
  twiml.pause({ length: 1 });
  twiml.say("Please hold while we connect you to an available agent.");
  twiml.pause({ length: 1 });

  try {
    const inboxId = await getDynamicInboxId();
    const availableAgent = await getAvailableAgent(inboxId);
    // console.log("agent id is: ", availableAgent)

    if (!availableAgent || !availableAgent.id) {
      twiml.pause({ length: 1 });
      twiml.say("All our agents are busy. Please hold while we connect you to the next available agent.");
      await holdUntilAgentAvailable(fromNumber, inboxId, twiml);
    } else {
      await setupConversationAndNotifyAgent(fromNumber, inboxId, availableAgent.id, availableAgent.available_name, twiml, callSid);
    }
  } catch (error) {
    console.log('Error in call handling:', error);
    twiml.pause({ length: 1 });
    twiml.say("We're experiencing technical difficulties. Please try calling again later.");
  }
}

// get inbox id
async function getDynamicInboxId() {
  try {
    const response = await axios.get(
      `${process.env.CHATWOOT_INSTANCE_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/inboxes`,
      { headers: { api_access_token: `${process.env.CHATWOOT_ACCESS_TOKEN}` } }
    );

    const inboxes = response.data.payload;
    // Select the first inbox
    return inboxes.length ? inboxes[0].id : null;
  } catch (error) {
    console.log('Error fetching inboxes:', error);
    throw error;
  }
}

// Check for available agents in the specified inbox
async function getAvailableAgent(inboxId) {
  try {
    const response = await axios.get(
      `${process.env.CHATWOOT_INSTANCE_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/agents`,
      { headers: { api_access_token: `${process.env.CHATWOOT_ACCESS_TOKEN}` } }
    );

    const agents = response.data;

    // Find the first online agent in the agents array
    const availableAgent = agents.find(agent => agent.availability_status === 'online');

    // Return the ID and name of the available agent or null if none are found
    return availableAgent ? { id: availableAgent.id, available_name: availableAgent.available_name } : null;
  } catch (error) {
    console.log('Error getting available agent:', error);
    return null;
  }
}

// Retry loop for agent availability
async function holdUntilAgentAvailable(fromNumber, inboxId, twiml) {
  let agentFound = false;
  let attempts = 0;
  const maxAttempts = 3;

  while (!agentFound && attempts < maxAttempts) {
    const availableAgent = await getAvailableAgent(inboxId);
    if (availableAgent && availableAgent.id) {
      await setupConversationAndNotifyAgent(fromNumber, inboxId, availableAgent.id, availableAgent.available_name, twiml);
      agentFound = true;
    } else {
      twiml.pause({ length: 1 });
      twiml.say("All our agents are still busy. Please hold while we connect you to the next available agent.");
      twiml.play('https://cdn.pixabay.com/download/audio/2021/09/18/audio_44d1f6dbed.mp3?filename=reflection_30sec-8472.mp3');
      twiml.pause({ length: 5 });
      attempts++;
    }
  }

  if (!agentFound) {
    twiml.pause({ length: 1 });
    twiml.say("We're sorry, but all our agents are still unavailable. Please try calling back later.");
  }
}


// get conversation id
async function getConversationId(contactId) {
  try {
    const encodedCredentials = Buffer.from(`${process.env.DYTE_ORG_ID}:${process.env.DYTE_API_KEY}`).toString('base64');

    const response = await axios.get(
      `${process.env.CHATWOOT_INSTANCE_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/contacts/${contactId}/conversations`,
      {
        headers: { api_access_token: process.env.CHATWOOT_ACCESS_TOKEN },
      }
    );

    // Check if there is at least one conversation in the payload data
    if (response.data.payload && response.data.payload.length > 0) {
      const conversationId = response.data.payload[0].id; // Get the ID of the first conversation
      return conversationId;
    } else {
      return null; // No conversation exists
    }
  } catch (error) {
    console.log('Error fetching conversation:', error.response ? error.response.data : error.message);
    return null;
  }
}

async function setupConversationAndNotifyAgent(fromNumber, inboxId, agentId, agentName, twiml, callSid) {
  try {
    let contactId;
    let sourceId;
    let conversationId;
    let meetingID;
    let dyteMeetingLink;

    // Step 1: Search for contact by phone number
    try {
      const searchResponse = await axios.get(
        `${process.env.CHATWOOT_INSTANCE_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/contacts/search?q=${fromNumber}`,
        {
          headers: { api_access_token: process.env.CHATWOOT_ACCESS_TOKEN },
        }
      );

      if (searchResponse.data.payload.length > 0) {
        const existingContact = searchResponse.data.payload[0];
        contactId = existingContact.id;

        if (contactId) {
          conversationId = await getConversationId(contactId);
          console.log('existing conversation id is: ', conversationId);
        }

        if (existingContact.contact_inboxes && existingContact.contact_inboxes.length > 0) {
          sourceId = existingContact.contact_inboxes[0].source_id;
        } else {
          throw new Error("Existing contact found but has no associated contact_inboxes.");
        }

        // console.log('contactId is: ', contactId);
        // console.log('sourceId is: ', sourceId);
      }
    } catch (error) {
      console.log('Error in search contact step:', error.response ? error.response.data : error.message);
      throw error;
    }

    // Step 2: Create a new contact if none exists
    if (!contactId) {
      try {
        const contactResponse = await axios.post(
          `${process.env.CHATWOOT_INSTANCE_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/contacts`,
          { name: fromNumber, phone_number: fromNumber, inbox_id: inboxId },
          { headers: { api_access_token: process.env.CHATWOOT_ACCESS_TOKEN } }
        );

        contactId = contactResponse.data.payload.contact.id;
        sourceId = contactResponse.data.payload.contact_inbox.source_id;

        // console.log('New contactId is: ', contactId);
        // console.log('New sourceId is: ', sourceId);

        if (!sourceId) {
          console.log('sourceId is not found and the current value is: ', sourceId);
        }
      } catch (error) {
        console.log('Error in create contact step:', error.response ? error.response.data : error.message);
        throw error;
      }
    }

    // Step 3: Create the new conversation if not an exisiting conversation for the caller
    if (!conversationId) {
      try {
        const conversationUrl = `${process.env.CHATWOOT_INSTANCE_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/conversations`;
        const conversationBody = {
          source_id: sourceId,
          inbox_id: inboxId,
          contact_id: contactId,
          status: "open",
        };
        // assignee_id: agentId,

        //   console.log('Creating conversation with:', conversationBody);

        const { data: conversationData } = await axios.post(
          conversationUrl,
          conversationBody,
          { headers: { api_access_token: `${process.env.CHATWOOT_ACCESS_TOKEN}` } }
        );

        conversationId = conversationData.id;
        console.log('new conversation id is: ', conversationId);
      } catch (error) {
        console.log('Error in create conversation step:', error.response ? error.response.data : error.message);
        throw error;
      }
    }

    // Step 4: Create Dyte meeting
    try {
      const encodedCredentials = Buffer.from(`${process.env.DYTE_ORG_ID}:${process.env.DYTE_API_KEY}`).toString('base64');
      //   console.log('Encoded API Key:', encodedCredentials);

      const dyteResponse = await axios.post(
        `https://api.dyte.io/v2/meetings`,
        {
          title: `Meeting for : ${fromNumber}`,
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

      meetingID = dyteResponse.data.data.id;

      // add available agent as a participant to the meeting
      try {
        const encodedCredentials = Buffer.from(`${process.env.DYTE_ORG_ID}:${process.env.DYTE_API_KEY}`).toString('base64');

        const response = await axios.post(`https://api.dyte.io/v2/meetings/${meetingID}/participants`, {
          name: String(agentName),
          preset_name: "group_call_host",
          custom_participant_id: String(agentId)
        }, {
          headers: {
            'Authorization': `Basic ${encodedCredentials}`,
            'Content-Type': 'application/json'
          }
        });

        // console.log(response.data);

        const authToken = response.data.data.token;
        // console.log('Auth Token:', authToken);

        dyteMeetingLink = `https://app.dyte.io/v2/meeting?id=${meetingID}&authToken=${authToken}`;
      } catch (error) {
        console.log('Error adding participant:', error.response ? error.response.data : error.message);
      }

      console.log('Dyte Meeting Link:', dyteMeetingLink);

      // Step 5: Send initial message to the conversation
      try {
        await axios.post(
          `${process.env.CHATWOOT_INSTANCE_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
          {
            content: `Incoming call from ${fromNumber}. Join the call here: ${dyteMeetingLink}`,
            message_type: 'incoming',
          },
          { headers: { api_access_token: process.env.CHATWOOT_ACCESS_TOKEN } }
        );

        twiml.pause({ length: 3 });
        twiml.say("An agent will be with you shortly.");
      } catch (error) {
        console.log('Error in send message step:', error.response ? error.response.data : error.message);
        throw error;
      }

      // Step 6: Dial SIP
      const dial = twiml.dial();
      //   const dial = twiml.dial({ record: 'record-from-answer' });
      dial.sip(
        {
          username: process.env.DYTE_SIP_USERNAME,
          password: process.env.DYTE_SIP_PASSWORD,
        },
        `sip:${meetingID}@sip.dyte.io`
      );

      // Subscribe to Dyte join event
      subscribeToDyteJoinEvent(meetingID, conversationId, fromNumber, agentName, callSid);

      console.log({ twiml: twiml.toString() });

    } catch (error) {
      console.log('Error in create Dyte meeting step:', error.response ? error.response.data : error.message);
      throw error;
    }
  } catch (error) {
    console.log('Error setting up conversation and notifying agent:', error.message);
    twiml.say("We're experiencing technical difficulties. Please try calling again later.");
  }
}

async function subscribeToDyteJoinEvent(meetingID, conversationId, fromNumber, agentName, callSid) {
  try {
    // Dyte Webhook Endpoint for Participant Joined Event
    const dyteWebhookUrl = `${process.env.SERVER_URL}/api/dyte-agent-joined?conversationId=${conversationId}&callSid=${callSid}`;

    // Set up webhook
    await axios.post(`https://api.dyte.io/v2/webhooks`, {
      name: `${agentName} join Webhook for ${fromNumber}`,
      url: dyteWebhookUrl,
      events: ["meeting.participantJoined"]
    }, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.DYTE_ORG_ID}:${process.env.DYTE_API_KEY}`).toString('base64')}`
      }
    });
  } catch (error) {
    console.log("Error setting up Dyte webhook:", error);
  }
}


// Fetch all webhooks to find the one with the matching conversationId
export const fetchWebhooks = async () => {
  const response = await fetch(`https://api.dyte.io/v2/webhooks`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${process.env.DYTE_ORG_ID}:${process.env.DYTE_API_KEY}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
  });
  return response.json();
};

// Delete the webhook by ID
export const deleteWebhook = async (webhookId) => {
  await fetch(`https://api.dyte.io/v2/webhooks/${webhookId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${process.env.DYTE_ORG_ID}:${process.env.DYTE_API_KEY}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
  });
};