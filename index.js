const express = require('express');
const cors = require('cors');
require('dotenv').config();
const OpenAI = require('openai');

const { v4: uuidv4 } = require('uuid');
const { db, initialiseDb, createLead, getDealWithLead } = require('./db');

const app = express();
const PORT = process.env.PORT || 3003;
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️  OPENAI_API_KEY is not set. AI endpoints will return stub responses.');
}

app.use(cors());
app.use(express.json());

initialiseDb();

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'lead-desk-backend',
    port: Number(PORT),
  });
});

app.get('/leads', (req, res) => {
  db.all('SELECT * FROM leads', [], (err, rows) => {
    if (err) {
      console.error('Error fetching leads:', err);
      return res.status(500).json({ error: 'Failed to fetch leads' });
    }
    res.json(rows);
  });
});

app.get('/deals', (req, res) => {
  db.all('SELECT * FROM deals', [], (err, rows) => {
    if (err) {
      console.error('Error fetching deals:', err);
      return res.status(500).json({ error: 'Failed to fetch deals' });
    }
    res.json(rows);
  });
});

app.post('/leads', (req, res) => {
  const {
    name,
    company,
    email,
    value,
    source,
    createdAt,
    address,
    phone,
  } = req.body || {};

  if (!name || !company) {
    return res
      .status(400)
      .json({ error: 'Both "name" and "company" fields are required.' });
  }

  const id = uuidv4();
  const lead = {
    id,
    name,
    company,
    email,
    value,
    source,
    createdAt,
    address,
    phone,
  };

  createLead(lead, (err) => {
    if (err) {
      console.error('Error inserting lead:', err);
      return res.status(500).json({ error: 'Failed to create lead' });
    }

    db.get('SELECT * FROM leads WHERE id = ?', [id], (selectErr, row) => {
      if (selectErr) {
        console.error('Error fetching new lead:', selectErr);
        return res
          .status(500)
          .json({ error: 'Lead created but failed to fetch' });
      }

      res.status(201).json(row);
    });
  });
});

app.post('/ai/next-step', (req, res) => {
  const { dealId } = req.body || {};
  if (!dealId) {
    return res.status(400).json({ error: '"dealId" is required' });
  }

  getDealWithLead(dealId, async (err, record) => {
    if (err) {
      console.error('Error fetching deal for AI next step:', err);
      return res.status(500).json({ error: 'Failed to fetch deal' });
    }
    if (!record) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    const { stage, nextAction, nextActionDate, leadName, leadCompany } = record;

    if (!process.env.OPENAI_API_KEY) {
      const suggestion =
        'AI is offline. Next best step: confirm the client’s priorities, share a concise update, and schedule the next touchpoint.';
      return res.json({ dealId, suggestion, source: 'stub' });
    }

    try {
      const systemPrompt =
        'You are a concise sales coach. Given a B2B deal and existing next action, suggest ONE clear "next best step" for the salesperson, in 2-3 sentences max. Focus on moving the deal forward, not generic advice.';

      const userContext = `
Deal stage: ${stage || 'unknown'}
Client name: ${leadName || 'unknown'}
Company: ${leadCompany || 'unknown'}
Next action on record: ${nextAction || 'not specified'}
Next action due date: ${nextActionDate || 'not specified'}
`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContext },
        ],
        max_tokens: 200,
      });

      const aiText =
        completion.choices?.[0]?.message?.content?.trim() ||
        'No suggestion generated.';

      res.json({
        dealId,
        suggestion: aiText,
        source: 'openai',
      });
    } catch (aiErr) {
      console.error('Error from OpenAI for next-step:', aiErr);
      const fallback =
        'AI suggestion temporarily unavailable. Focus on confirming the client’s priorities and agreeing a clear next meeting date.';
      res.json({ dealId, suggestion: fallback, source: 'fallback' });
    }
  });
});

app.post('/ai/reminder-text', (req, res) => {
  const { dealId, channel } = req.body || {};
  if (!dealId) {
    return res.status(400).json({ error: '"dealId" is required' });
  }
  if (channel !== 'SMS' && channel !== 'WhatsApp') {
    return res.status(400).json({ error: '"channel" must be "SMS" or "WhatsApp"' });
  }

  getDealWithLead(dealId, async (err, record) => {
    if (err) {
      console.error('Error fetching deal for AI reminder:', err);
      return res.status(500).json({ error: 'Failed to fetch deal' });
    }
    if (!record) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    const { nextAction, nextActionDate, leadName, leadCompany } = record;

    const displayName = leadName || 'your client';
    const companyName = leadCompany ? ` at ${leadCompany}` : '';
    const datePart = nextActionDate ? ` on ${nextActionDate}` : '';
    const actionPart = nextAction
      ? ` about "${nextAction}"`
      : ' about the next step in your project';

    if (!process.env.OPENAI_API_KEY) {
      const stub =
        `Reminder: contact ${displayName}${companyName}${actionPart}${datePart}. ` +
        'Keep it short, reconfirm their priorities, and suggest a specific time for the next call.';
      return res.json({
        dealId,
        channel,
        message: stub,
        source: 'stub',
      });
    }

    try {
      const systemPrompt =
        'You are a sales assistant. Generate a short, friendly reminder message (1–2 sentences) suitable for ' +
        (channel === 'WhatsApp' ? 'WhatsApp' : 'SMS') +
        ', reminding the salesperson what they need to do next. Address the opportunity in neutral terms (no greeting, no signature).';

      const userContext = `
Recipient: ${displayName}${companyName}
Next action: ${nextAction || 'not specified'}
Due: ${nextActionDate || 'not specified'}
Channel: ${channel}
`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContext },
        ],
        max_tokens: 120,
      });

      const aiText =
        completion.choices?.[0]?.message?.content?.trim() ||
        'No reminder generated.';

      res.json({
        dealId,
        channel,
        message: aiText,
        source: 'openai',
      });
    } catch (aiErr) {
      console.error('Error from OpenAI for reminder-text:', aiErr);
      const fallback =
        `Reminder: contact ${displayName}${companyName}${actionPart}${datePart}. ` +
        'AI is temporarily unavailable, so keep it short and reconfirm next steps.';
      res.json({
        dealId,
        channel,
        message: fallback,
        source: 'fallback',
      });
    }
  });
});

app.listen(PORT, () => {
  console.log(`Lead Desk backend listening on port ${PORT}`);
});
