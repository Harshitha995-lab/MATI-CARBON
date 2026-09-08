const twilio = require('twilio');

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const { Body, From } = req.body || {};

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(`You said: "${Body || ''}" (from ${From || 'unknown'})`);

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
};
