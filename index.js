const express = require('express');
const cors = require('cors');
require('dotenv').config();
const OpenAI = require('openai');

const { v4: uuidv4 } = require('uuid');
const {
  db,
  initialiseDb,
  createLead,
  getLeads,
  getDealWithLead,
  createActivity,
  getActivitiesForDeal,
  updateDealStage,
  createDeal,
  updateDealDetails,
  deleteLeadAndRelated,
  getDealsWithLeadAndLastActivity,
  getDealContextForMessageDraft,
  getRecentActivitiesForDeal,
  getOutreachStepsForDeal,
  createOutreachSteps,
  updateOutreachStepStatus,
} = require('./db');

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
  getLeads((err, rows) => {
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

app.post('/deals', (req, res) => {
  const {
    leadId,
    title,
    value,
    stage,
    nextAction,
    nextActionDate,
    reminderChannel,
    aiAutoReminderEnabled,
    ownerName,
  } = req.body || {};

  if (!leadId || typeof leadId !== 'string' || !leadId.trim()) {
    return res.status(400).json({ error: 'leadId is required' });
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }

  const dealInput = {
    leadId: leadId.trim(),
    title: title.trim(),
    stage: stage && typeof stage === 'string' ? stage : 'New',
    value: typeof value === 'number' ? value : 0,
    nextAction: typeof nextAction === 'string' ? nextAction.trim() : null,
    nextActionDate: nextActionDate || null,
    reminderChannel: typeof reminderChannel === 'string' ? reminderChannel.trim() : null,
    aiAutoReminderEnabled: !!aiAutoReminderEnabled,
    ownerName: ownerName && typeof ownerName === 'string' ? ownerName : 'Unassigned',
  };

  createDeal(dealInput, (err, createdDeal) => {
    if (err) {
      console.error('Failed to create deal', err);
      return res.status(500).json({ error: 'Failed to create deal' });
    }

    if (!createdDeal) {
      return res.status(500).json({ error: 'Deal not created' });
    }

    return res.status(201).json(createdDeal);
  });
});

app.post('/deals/:dealId/details', (req, res) => {
  const { dealId } = req.params;
  const { value, nextAction, nextActionDate } = req.body || {};

  const details = {};

  if (typeof value === 'number') {
    details.value = value;
  }

  if (typeof nextAction === 'string') {
    details.nextAction = nextAction.trim();
  }

  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'nextActionDate')) {
    details.nextActionDate = nextActionDate || null;
  }

  if (Object.keys(details).length === 0) {
    return res.status(400).json({ error: 'At least one of value, nextAction, or nextActionDate is required' });
  }

  updateDealDetails(dealId, details, (err, updatedDeal) => {
    if (err) {
      console.error('Failed to update deal details', err);
      return res.status(500).json({ error: 'Failed to update deal details' });
    }

    if (!updatedDeal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    return res.status(200).json(updatedDeal);
  });
});

app.get('/deals/:dealId/activities', (req, res) => {
  const { dealId } = req.params;
  getActivitiesForDeal(dealId, (err, rows) => {
    if (err) {
      console.error('Error fetching activities:', err);
      return res.status(500).json({ error: 'Failed to fetch activities' });
    }
    res.json(rows);
  });
});

app.get('/deals/:dealId/outreach-steps', (req, res) => {
  const { dealId } = req.params;

  if (!dealId) {
    return res.status(400).json({ error: 'dealId is required' });
  }

  getOutreachStepsForDeal(dealId, (err, steps) => {
    if (err) {
      console.error('Failed to fetch outreach steps', err);
      return res.status(500).json({ error: 'Failed to fetch outreach steps' });
    }

    return res.json(steps);
  });
});

app.post('/deals/:dealId/activities', (req, res) => {
  const { dealId } = req.params;
  const { type, note, createdAt } = req.body || {};

  if (!type || !note) {
    return res.status(400).json({ error: 'type and note are required' });
  }

  const id = uuidv4();
  const activity = {
    id,
    dealId,
    type,
    note,
    createdAt: createdAt || new Date().toISOString(),
  };

  createActivity(activity, (err) => {
    if (err) {
      console.error('Error inserting activity:', err);
      return res.status(500).json({ error: 'Failed to create activity' });
    }
    res.status(201).json(activity);
  });
});

app.patch('/outreach-steps/:stepId/status', (req, res) => {
  const { stepId } = req.params;
  const { status } = req.body || {};

  const allowedStatuses = ['pending', 'done', 'skipped'];
  if (!stepId || !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  updateOutreachStepStatus(stepId, status, (err, result) => {
    if (err) {
      console.error('Failed to update outreach step status', err);
      return res.status(500).json({ error: 'Failed to update outreach step status' });
    }

    if (result && result.notFound) {
      return res.status(404).json({ error: 'Outreach step not found' });
    }

    return res.status(200).json({ ok: true, status });
  });
});

function normalizeIntentForStage(stage, originalIntent, hasAnyContact) {
  if (!originalIntent) return 'nurture_checkin';

  const intent = String(originalIntent).toLowerCase();
  const stageLower = stage ? String(stage).toLowerCase() : '';

  if (intent === 'first_contact') {
    if (stageLower === 'new') {
      return 'first_contact';
    }

    if (stageLower === 'qualified') {
      return 'nurture_checkin';
    }

    if (stageLower === 'proposal sent' || stageLower === 'proposal_sent') {
      return 'proposal_followup';
    }

    if (stageLower === 'won') {
      return 'post_call_summary';
    }

    if (stageLower === 'lost') {
      return 'deal_recovery';
    }

    if (hasAnyContact) {
      return 'nurture_checkin';
    }
  }

  const allowedIntents = new Set([
    'first_contact',
    'post_call_summary',
    'proposal_followup',
    'nurture_checkin',
    'deal_recovery',
    'meeting_confirmation',
    'meeting_reminder',
    'invoice_gentle',
    'invoice_firm',
    'invoice_final',
  ]);

  if (allowedIntents.has(intent)) {
    return intent;
  }

  return 'nurture_checkin';
}

app.post('/ai/outreach-plan', (req, res) => {
  const { dealId, horizonDays } = req.body || {};

  if (!dealId) {
    return res.status(400).json({ error: 'dealId is required' });
  }

  const parsedHorizon = Number.isInteger(horizonDays) && horizonDays > 0 ? horizonDays : 14;
  const allowedChannels = ['email', 'whatsapp', 'sms', 'call_script'];
  const allowedIntents = [
    'first_contact',
    'post_call_summary',
    'proposal_followup',
    'nurture_checkin',
    'deal_recovery',
    'meeting_confirmation',
    'meeting_reminder',
    'invoice_gentle',
    'invoice_firm',
    'invoice_final',
  ];

  getDealContextForMessageDraft(dealId, async (err, context) => {
    if (err) {
      console.error('Error fetching deal for outreach plan:', err);
      return res.status(500).json({ error: 'Failed to generate outreach plan' });
    }

    if (!context) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    getRecentActivitiesForDeal(dealId, 5, async (activitiesErr, activityRows) => {
      if (activitiesErr) {
        console.error('Error fetching recent activities for outreach plan:', activitiesErr);
      }

      const recentActivities = (activityRows || []).map((row) => ({
        type: row.type || null,
        createdAt: row.createdAt || null,
        note: row.note || null,
      }));

      const input = {
        appName: 'lead_desk',
        horizonDays: parsedHorizon,
        deal: {
          id: context.dealId || dealId,
          stage: context.stage,
          valueGBP: context.valueGBP || null,
          name: context.dealName || null,
        },
        lead: {
          name: context.leadName || null,
          company: context.company || null,
        },
        recentHistory: {
          lastContactType: context.lastActivityType || null,
          lastContactDate: context.lastActivityDate || null,
          recentActivities,
        },
      };
      const hasAnyContact = !!context.lastActivityDate || recentActivities.length > 0;

      async function buildAndStoreSteps(modelSteps) {
        const today = new Date();
        const stepsToInsert = [];

        const normalizedSteps = (modelSteps || []).map((step) => {
          const normalizedIntent = normalizeIntentForStage(
            context.stage,
            step.intent,
            hasAnyContact,
          );

          return {
            ...step,
            intent: normalizedIntent,
          };
        });

        normalizedSteps.forEach((step) => {
          if (
            typeof step !== 'object' ||
            typeof step.offsetDays !== 'number' ||
            step.offsetDays < 0 ||
            step.offsetDays > parsedHorizon
          ) {
            return;
          }

          if (!allowedChannels.includes(step.channel) || !allowedIntents.includes(step.intent)) {
            return;
          }

          const due = new Date(today);
          due.setHours(9, 0, 0, 0);
          due.setDate(due.getDate() + step.offsetDays);

          stepsToInsert.push({
            id: uuidv4(),
            dealId,
            dueDate: due.toISOString(),
            channel: step.channel,
            intent: step.intent,
            goal: step.goal || null,
            status: 'pending',
          });
        });

        if (stepsToInsert.length === 0) {
          return null;
        }

        return new Promise((resolve, reject) => {
          createOutreachSteps(stepsToInsert, (createErr) => {
            if (createErr) {
              return reject(createErr);
            }

            getOutreachStepsForDeal(dealId, (fetchErr, rows) => {
              if (fetchErr) {
                return reject(fetchErr);
              }
              resolve(rows || []);
            });
          });
        });
      }

      async function handleStubResponse() {
        const stub = [
          {
            offsetDays: 0,
            channel: 'email',
            intent: 'first_contact',
            goal: 'Send a concise intro email with value props and propose a short call.',
          },
          {
            offsetDays: 3,
            channel: 'whatsapp',
            intent: 'nurture_checkin',
            goal: 'Lightly check in to see if they had a chance to review.',
          },
          {
            offsetDays: 7,
            channel: 'call_script',
            intent: 'post_call_summary',
            goal: 'Call to recap fit, address questions, and agree next steps.',
          },
        ];

        return buildAndStoreSteps(stub);
      }

      if (!process.env.OPENAI_API_KEY) {
        return handleStubResponse()
          .then((rows) => res.status(200).json({ dealId, steps: rows || [] }))
          .catch((storeErr) => {
            console.error('Failed to store stub outreach steps', storeErr);
            res.status(500).json({ error: 'Failed to generate outreach plan' });
          });
      }

      try {
        const systemMessage =
          'You are the Outreach Planner for Lead Desk. Plan 3-5 concrete outreach steps over the next horizonDays.' +
          ' Use only channels: email, whatsapp, sms, call_script. Use intents from the provided list.' +
          ' Provide short human-readable goals. Use GBP/£ if you mention amounts.' +
          ' recentHistory.recentActivities is an array of recent events (type, createdAt, note) you can use to set tone.' +
          ' Output ONLY valid JSON with a top-level "steps" array of objects: {offsetDays, channel, intent, goal}.' +
          ' offsetDays must be between 0 and the provided horizonDays.';

        const completion = await openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: JSON.stringify({ input }) },
          ],
        });

        const content = completion.choices?.[0]?.message?.content || '{}';
        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch (jsonErr) {
          console.error('Failed to parse outreach plan JSON:', jsonErr);
          parsed = null;
        }

        const created = await buildAndStoreSteps(parsed?.steps);

        if (!created) {
          console.warn('No outreach steps created from AI; using stub fallback');
          const fallback = await handleStubResponse();
          return res.status(200).json({ dealId, steps: fallback || [] });
        }

        return res.status(200).json({ dealId, steps: created });
      } catch (aiErr) {
        console.error('Error generating outreach plan:', aiErr);
        return handleStubResponse()
          .then((rows) => res.status(200).json({ dealId, steps: rows || [] }))
          .catch((storeErr) => {
            console.error('Failed to store fallback outreach steps', storeErr);
            res.status(500).json({ error: 'Failed to generate outreach plan' });
          });
      }
    });
  });
});

app.delete('/leads/:leadId', (req, res) => {
  const { leadId } = req.params;

  deleteLeadAndRelated(leadId, (err, result) => {
    if (err) {
      console.error('Failed to delete lead and related data', err);
      return res.status(500).json({ error: 'Failed to delete lead' });
    }

    if (result && result.notFound) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    return res.status(200).json({ success: true });
  });
});

app.post('/deals/:dealId/stage', (req, res) => {
  const { dealId } = req.params;
  const { stage } = req.body || {};

  if (!stage || typeof stage !== 'string' || !stage.trim()) {
    return res.status(400).json({ error: 'stage is required' });
  }

  updateDealStage(dealId, stage.trim(), (err, updatedDeal) => {
    if (err) {
      console.error('Failed to update deal stage', err);
      return res.status(500).json({ error: 'Failed to update deal stage' });
    }

    if (!updatedDeal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    const activity = {
      id: uuidv4(),
      dealId,
      type: 'status_change',
      note: `Status updated to ${updatedDeal.stage}`,
      createdAt: new Date().toISOString(),
    };

    createActivity(activity, (activityErr) => {
      if (activityErr) {
        console.error('Failed to record status change activity', activityErr);
      }
      return res.status(200).json(updatedDeal);
    });
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
    ownerName,
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
    ownerName: ownerName && typeof ownerName === 'string' ? ownerName : 'Unassigned',
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

    const { stage, nextAction, nextActionDate, leadName, leadCompany, ownerName } = record;
    const ownerLabel =
      (ownerName && typeof ownerName === 'string' && ownerName.trim()) ||
      'Unassigned';

    if (!process.env.OPENAI_API_KEY) {
      const suggestion =
        'AI is offline. Next best step: confirm the client’s priorities, share a concise update, and schedule the next touchpoint.';
      return res.json({ dealId, suggestion, source: 'stub' });
    }

    try {
      const systemPrompt =
        'You are a concise sales coach. Given a B2B deal and existing next action, suggest ONE clear "next best step" for the salesperson, in 2-3 sentences max. Focus on moving the deal forward, not generic advice. Use the ownerName field from the input context. The suggestedAction text should start with the ownerName followed by a dash, e.g., "Zax Kalyan – Call Gemma tomorrow to confirm the proposal and clarify any concerns."';

      const userContext = `
{
  "dealId": "${dealId}",
  "stage": "${stage || 'unknown'}",
  "value": ${Number.isFinite(record.value) ? Number(record.value) : 0},
  "leadName": "${leadName || 'unknown'}",
  "company": "${leadCompany || 'unknown'}",
  "ownerName": "${ownerLabel}",
  "nextAction": "${nextAction || 'not specified'}",
  "nextActionDate": "${nextActionDate || 'not specified'}"
}
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

app.post('/ai/deal-recovery', (req, res) => {
  const { dealId, userNotes } = req.body || {};

  if (!dealId) {
    return res.status(400).json({ error: 'dealId is required' });
  }

  getDealWithLead(dealId, (dealErr, deal) => {
    if (dealErr) {
      console.error('Error fetching deal for recovery:', dealErr);
      return res.status(500).json({ error: 'Failed to fetch deal' });
    }

    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    getActivitiesForDeal(dealId, async (activitiesErr, activityRows) => {
      if (activitiesErr) {
        console.error('Error fetching activities for recovery:', activitiesErr);
      }

      const activities = activityRows || [];
      const ownerLabel =
        (deal.ownerName && typeof deal.ownerName === 'string' && deal.ownerName.trim()) ||
        (deal.leadOwnerName && typeof deal.leadOwnerName === 'string' && deal.leadOwnerName.trim()) ||
        'Unassigned';

      const context = {
        deal: {
          id: deal.id,
          title: deal.title,
          stage: deal.stage,
          value: deal.value,
          nextAction: deal.nextAction,
          nextActionDate: deal.nextActionDate,
        },
        lead: {
          name: deal.leadName,
          company: deal.leadCompany,
          email: deal.leadEmail,
        },
        ownerName: ownerLabel,
        activities: activities.map((a) => ({
          type: a.type,
          note: a.note,
          createdAt: a.createdAt,
        })),
        userNotes: userNotes || null,
      };

      let reasonSummary;
      if (userNotes && typeof userNotes === 'string' && userNotes.trim()) {
        reasonSummary = `Based on your notes, this situation looks like: ${userNotes.trim()}`;
      } else {
        switch (deal.stage) {
          case 'Lost':
            reasonSummary =
              'This deal appears to be stalled or marked as Lost. Common reasons include price, timing, or misalignment with the client\'s priorities.';
            break;
          case 'New':
            reasonSummary =
              'This is a new lead. The main risk is lack of clarity on fit, priorities, and decision-makers.';
            break;
          case 'Qualified':
            reasonSummary =
              'This is a qualified opportunity. The main risks are unclear budget, timing, and unspoken objections.';
            break;
          case 'Proposal Sent':
            reasonSummary =
              'A proposal has been sent. The main risk is going quiet without addressing hidden concerns or decision dynamics.';
            break;
          case 'Won':
            reasonSummary =
              'This is a won deal. The main risk is poor onboarding or missed expansion opportunities.';
            break;
          default:
            reasonSummary =
              'This deal is in progress. The main risks are unclear next steps and unaddressed concerns.';
            break;
        }
      }

      let recoveryIdeas;
      let messageTemplate;

      switch (deal.stage) {
        case 'Lost':
          recoveryIdeas = [
            'Send a short check-in asking if priorities have changed or if concerns remain.',
            'Offer a lighter/pilot package to reduce risk and re-open the conversation.',
            'Ask for permission to stay in touch with occasional, high-value insights.',
          ];
          messageTemplate =
            'Hi {{CLIENT_NAME}},\n\nI know we haven’t moved ahead yet, but I wanted to check in briefly in case your priorities have shifted. If helpful, I can suggest a smaller, lower-risk way to test this with you and address any concerns.\n\nThanks,\n{{YOUR_NAME}}';
          break;
        case 'Won':
          recoveryIdeas = [
            'Confirm onboarding success criteria and timeline with clear owners.',
            'Schedule a kickoff to align on quick wins and risk areas.',
            'Identify expansion, referral, or upsell opportunities once early value is proven.',
          ];
          messageTemplate =
            'Hi {{CLIENT_NAME}},\n\nExcited to get you live. Can we confirm your success criteria and timeline, and schedule a quick kickoff to align owners? I can also share a plan for early wins and discuss potential expansion paths once we deliver them.\n\nThanks,\n{{YOUR_NAME}}';
          break;
        case 'Proposal Sent':
          recoveryIdeas = [
            'Follow up with a concise summary of value, pricing, and next steps.',
            'Surface hidden concerns by asking about decision-makers and timeline.',
            'Offer a short call to address objections and agree a decision date.',
          ];
          messageTemplate =
            'Hi {{CLIENT_NAME}},\n\nFollowing our proposal, I want to ensure we’ve addressed all questions. Are there any concerns from your side or other decision-makers? If helpful, I can walk through the key points briefly and align on a decision date.\n\nThanks,\n{{YOUR_NAME}}';
          break;
        case 'New':
        case 'Qualified':
          recoveryIdeas = [
            'Clarify the problem, urgency, and success criteria with the client.',
            'Confirm budget, timeline, and the decision-making process.',
            'Propose a small next step (demo, pilot, or workshop) to de-risk.',
          ];
          messageTemplate =
            'Hi {{CLIENT_NAME}},\n\nThanks for the recent conversation. To make this valuable, could we confirm your top priorities, timing, and decision process? I can suggest a focused next step (demo, pilot, or workshop) to de-risk and show quick value.\n\nThanks,\n{{YOUR_NAME}}';
          break;
        default:
          recoveryIdeas = [
            'Clarify the client’s current priorities and any blockers.',
            'Confirm decision process, timeline, and remaining questions.',
            'Propose a clear next step to keep momentum (short call, demo, or pilot).',
          ];
          messageTemplate =
            'Hi {{CLIENT_NAME}},\n\nChecking in to make sure we’re aligned on priorities and next steps. Are there any open questions or blockers? I can propose a short call to confirm the plan and keep things moving.\n\nThanks,\n{{YOUR_NAME}}';
          break;
      }

      const stub = {
        dealId,
        reasonSummary,
        recoveryIdeas,
        messageTemplate,
        source: 'stub',
      };

      if (!process.env.OPENAI_API_KEY) {
        return res.status(200).json(stub);
      }

      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You are a sales coach helping with deals at any stage. Always respond in JSON. Use the ownerName field and address the owner directly. All primary suggestion strings should start with "<ownerName> – " (e.g., "Ram Sharma – Re-open the conversation by acknowledging the delay and offering a focused, time-boxed call to clarify the proposal.").',
            },
            {
              role: 'user',
              content: JSON.stringify({
                task: 'analyse_deal',
                instructions:
                  'You are a sales coach. Use the CURRENT stage as the source of truth. If stage is "Lost", focus on why it was lost and how to revive/re-open. If stage is "New" or "Qualified", treat it as an active opportunity and focus on clarifying fit, priorities, and next steps. If stage is "Proposal Sent", focus on closing, handling objections, and follow-up strategy. If stage is "Won", focus on onboarding, expansion, and strengthening the relationship. NEVER describe the deal as lost unless the stage is exactly "Lost". Use the rep\'s notes and activity history to make advice concrete. Respond in JSON with keys reasonSummary, recoveryIdeas (array of short bullet-style strings), and messageTemplate (a concise outreach email or message). Each reasonSummary and recoveryIdeas item should start with "<ownerName> – " addressing the owner. Use GBP / £ if you reference amounts.',
                context,
              }),
            },
          ],
          max_tokens: 400,
        });

        const content = completion.choices?.[0]?.message?.content;
        let parsed;
        try {
          parsed = JSON.parse(content || '{}');
        } catch (parseErr) {
          console.error('Failed to parse deal recovery AI response', parseErr, content);
        }

        if (
          parsed &&
          typeof parsed.reasonSummary === 'string' &&
          Array.isArray(parsed.recoveryIdeas) &&
          typeof parsed.messageTemplate === 'string'
        ) {
          return res.status(200).json({
            dealId,
            reasonSummary: parsed.reasonSummary,
            recoveryIdeas: parsed.recoveryIdeas,
            messageTemplate: parsed.messageTemplate,
            source: 'openai',
          });
        }

        return res.status(200).json({ ...stub, source: 'fallback' });
      } catch (aiErr) {
        console.error('Error from OpenAI for deal recovery:', aiErr);
        return res.status(200).json({ ...stub, source: 'fallback' });
      }
    });
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

app.post('/ai/message-draft', (req, res) => {
  const { dealId, intent, channel, userNotes } = req.body || {};

  if (!dealId || !intent || !channel) {
    return res.status(400).json({ error: 'dealId, intent and channel are required' });
  }

  getDealContextForMessageDraft(dealId, async (err, context) => {
    if (err) {
      console.error('Error fetching deal context for message draft:', err);
      return res.status(500).json({ error: 'Failed to generate message draft' });
    }

    if (!context) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    const input = {
      appName: 'lead_desk',
      businessContext:
        'Kalyan AI builds custom AI and automation systems to save time, reduce errors and increase profitability for business owners.',
      intent,
      channel,
      ownerName: (context.dealOwnerName && context.dealOwnerName.trim()) || 'Unassigned',
      senderName:
        (context.dealOwnerName && context.dealOwnerName.trim()) || 'Your sales advisor',
      leadProfile: {
        name: context.leadName,
        company: context.company,
        role: context.role,
        email: context.email,
        phone: context.phone,
        timezone: null,
      },
      dealContext: {
        stage: context.stage,
        dealName: context.dealName,
        valueGBP: context.valueGBP,
        productsOrServices: context.productsOrServices,
        keyBenefits: context.keyBenefits,
        decisionMakers: null,
      },
      recentHistory: {
        summary: null,
        lastContactType: context.lastActivityType,
        lastContactDate: context.lastActivityDate,
        lastContactNotes: context.lastActivityNotes,
      },
      userNotes: userNotes || null,
      constraints: {
        maxWords: 250,
        tone: 'default',
        includeCalendarLink: false,
        calendarLinkUrl: null,
        dueDate: null,
      },
    };

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Failed to generate message draft' });
    }

    try {
      const systemPrompt =
        'You are the Global Outreach Copilot for Kalyan AI. Draft outreach tailored to the intent and channel. Be clear, confident, and helpful, without hype. Use GBP (£). Never invent discounts, guarantees, or precise dates not provided. Use senderName from the input as the human sending the message. Write the body as if it is from senderName to the client, and include an appropriate sign-off with the sender’s name for email/whatsapp/sms. Do NOT prefix the content with the owner name plus a dash; write it like a normal outbound message. Respond with VALID JSON ONLY in this shape: {"channel":"email|whatsapp|sms|call_script","subject":string|null,"body":string,"toneSummary":string,"rationale":string,"safetyNotes":string}.';

      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({ input }),
          },
        ],
        max_tokens: 400,
      });

      const content = completion.choices?.[0]?.message?.content;
      let parsed;
      try {
        parsed = content ? JSON.parse(content) : null;
      } catch (parseErr) {
        throw parseErr;
      }

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid AI response format');
      }

      return res.json(parsed);
    } catch (aiErr) {
      console.error('Error from OpenAI for message-draft:', aiErr);
      return res.status(500).json({ error: 'Failed to generate message draft' });
    }
  });
});

app.get('/ai/leads-summary', (req, res) => {
  getDealsWithLeadAndLastActivity(async (err, rows) => {
    if (err) {
      console.error('Error loading deals for leads summary:', err);
      return res.status(500).json({ error: 'Failed to generate AI leads summary' });
    }

    const deals = rows || [];
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const msPerDay = 1000 * 60 * 60 * 24;

    const compactDeals = deals.map((deal) => {
      let daysSinceLastContact = null;
      if (deal.lastActivityDate) {
        const lastDate = new Date(deal.lastActivityDate);
        if (!Number.isNaN(lastDate.getTime())) {
          daysSinceLastContact = Math.floor((today.getTime() - lastDate.getTime()) / msPerDay);
        }
      }

      return {
        leadId: deal.leadId,
        dealId: deal.id,
        leadName: deal.leadName,
        company: deal.leadCompany,
        stage: deal.stage,
        value: Number.isFinite(deal.value) ? Number(deal.value) : 0,
        nextAction: deal.nextAction,
        nextActionDate: deal.nextActionDate,
        lastActivityType: deal.lastActivityType || null,
        lastActivityDate: deal.lastActivityDate || null,
        daysSinceLastContact,
        ownerName: (deal.ownerName && deal.ownerName.trim()) || (deal.leadOwnerName && deal.leadOwnerName.trim()) || 'Unassigned',
      };
    });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Failed to generate AI leads summary' });
    }

    try {
      const systemPrompt =
        'You are a concise sales coach creating a daily briefing for the Leads page. You MUST respond with a single valid JSON object only. No markdown, no commentary, no backticks.';

      const instructions =
        'Assume today is provided. Prioritise: 1) deals with nextActionDate today or overdue, 2) higher-value Qualified/Proposal Sent with no recent contact, 3) New leads with no first contact. For each action item in todaysTopActions, overdueAtRisk, and newAndWarming, prefix the line with ownerName and a dash (e.g., "Zax Kalyan – Call Gemma about The Green Man (Proposal Sent, 3 days since last contact)."). Use ownerName from the input; if missing or Unassigned, use "Owner". For each topActions item include actionType (call/email/whatsapp/sms/meeting), why, and suggestedStep. Keep everything concise, skimmable, and use GBP (£). If little data, keep lists short and explain briefly. Respond ONLY with valid JSON (no trailing commas).';

      const userPayload = {
        task: 'leads_daily_brief',
        today: todayStr,
        deals: compactDeals,
        instructions,
      };

      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify(userPayload),
          },
        ],
        max_tokens: 500,
      });

      const content = completion.choices?.[0]?.message?.content;
      let parsed;
      try {
        parsed = content ? JSON.parse(content) : null;
      } catch (parseErr) {
        console.error('Failed to parse AI leads summary JSON:', content);
        throw parseErr;
      }

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid AI response format');
      }

      return res.json({
        ...parsed,
        source: 'openai:gpt-4.1-mini',
      });
    } catch (aiErr) {
      console.error('Error from OpenAI for leads-summary:', aiErr);
      return res.status(500).json({ error: 'Failed to generate AI leads summary' });
    }
  });
});

app.get('/ai/pipeline-insights', (req, res) => {
  db.all(
    `
    SELECT
      d.*,
      l.name AS leadName,
      l.company AS leadCompany,
      l.ownerName AS leadOwnerName
    FROM deals d
    LEFT JOIN leads l ON l.id = d.leadId
    `,
    [],
    async (err, rows) => {
      if (err) {
        console.error('Error loading pipeline data:', err);
        return res.status(500).json({ error: 'Failed to load pipeline data' });
      }

      const deals = rows || [];
      const totalDeals = deals.length;
      const totalValue = deals.reduce(
        (sum, d) => sum + (Number.isFinite(d.value) ? Number(d.value) : 0),
        0,
      );
      const valueByStage = deals.reduce((acc, d) => {
        const stage = d.stage || 'Unknown';
        const v = Number.isFinite(d.value) ? Number(d.value) : 0;
        acc[stage] = (acc[stage] || 0) + v;
        return acc;
      }, {});

      const meta = {
        totalDeals,
        totalValue,
        valueByStage,
        generatedAt: new Date().toISOString(),
      };
      const formattedTotalValue = totalValue.toLocaleString('en-GB', {
        style: 'currency',
        currency: 'GBP',
      });

      const topStage =
        Object.keys(valueByStage).length === 0
          ? 'N/A'
          : Object.entries(valueByStage).sort((a, b) => b[1] - a[1])[0][0];

      const stub = {
        snapshot: `You have ${totalDeals} deals with total pipeline value of ${formattedTotalValue}. Top stage by value is ${topStage}.`,
        coaching:
          `Focus on the higher-value deals in ${topStage} and keep momentum; clear out stalled, low-value items so the team can concentrate on the best opportunities.`,
        source: 'stub',
        meta,
      };

      if (!process.env.OPENAI_API_KEY) {
        return res.json(stub);
      }

      try {
        const compactDeals = deals
          .map((d) => {
            const ownerLabel =
              (d.ownerName && typeof d.ownerName === 'string' && d.ownerName.trim()) ||
              (d.leadOwnerName && typeof d.leadOwnerName === 'string' && d.leadOwnerName.trim()) ||
              'Unassigned';
            return `• ${d.id}: ${d.title || 'Untitled'} | stage=${d.stage || 'unknown'} | value=£${d.value ?? 0} | lead=${d.leadName || 'unknown'} @ ${d.leadCompany || 'unknown'} | owner=${ownerLabel}`;
          })
          .join('\n');

        const systemPrompt =
          'You are a concise revenue coach. Given pipeline stats and a compact deal list, return STRICT JSON with keys "snapshot" and "coaching" only. Keep each value to 2-3 sentences. Be specific and action-oriented. All amounts are in GBP (British Pounds); use the £ symbol. Use ownerName on each deal to mention who should act; in coaching, reference the owner when suggesting next best moves. If ownerName is Unassigned/missing, refer to "the team".';

        const userContext = `
Pipeline stats:
- totalDeals: ${totalDeals}
- totalValue (GBP): ${formattedTotalValue}
- valueByStage: ${JSON.stringify(valueByStage)}

Deals:
${compactDeals}
`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContext },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 220,
        });

        const content = completion.choices?.[0]?.message?.content;
        let parsed;
        try {
          parsed = content ? JSON.parse(content) : null;
        } catch (parseErr) {
          throw parseErr;
        }

        if (!parsed || typeof parsed.snapshot !== 'string' || typeof parsed.coaching !== 'string') {
          throw new Error('Invalid AI response format');
        }

        return res.json({
          snapshot: parsed.snapshot,
          coaching: parsed.coaching,
          source: 'openai',
          meta,
        });
      } catch (aiErr) {
        console.error('Error from OpenAI for pipeline-insights:', aiErr);
        return res.json({
          ...stub,
          source: 'fallback',
        });
      }
    },
  );
});

app.listen(PORT, () => {
  console.log(`Lead Desk backend listening on port ${PORT}`);
});
