const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'leads-crm.sqlite');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

function initialiseDb() {
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        company TEXT NOT NULL,
        email TEXT,
        value INTEGER,
        source TEXT,
        createdAt TEXT,
        address TEXT,
        phone TEXT
      )`,
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS deals (
        id TEXT PRIMARY KEY,
        leadId TEXT NOT NULL,
        title TEXT NOT NULL,
        stage TEXT NOT NULL,
        value INTEGER,
        nextAction TEXT,
        nextActionDate TEXT,
        reminderChannel TEXT,
        aiAutoReminderEnabled INTEGER,
        FOREIGN KEY (leadId) REFERENCES leads(id)
      )`,
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS outreach_steps (
        id TEXT PRIMARY KEY,
        dealId TEXT NOT NULL,
        dueDate TEXT NOT NULL,
        channel TEXT NOT NULL,
        intent TEXT NOT NULL,
        goal TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        completedAt TEXT,
        FOREIGN KEY (dealId) REFERENCES deals(id) ON DELETE CASCADE
      )`,
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        dealId TEXT NOT NULL,
        type TEXT NOT NULL,
        note TEXT NOT NULL,
        createdAt TEXT NOT NULL
      )`,
      (err) => {
        if (err) {
          console.error('Error creating activities table:', err);
        } else {
          console.log('Activities table ready');
        }
      },
    );

    seedDemoData();
  });
}

function createLead(lead, callback) {
  const {
    id,
    name,
    company,
    email,
    value,
    source,
    createdAt,
    address,
    phone,
  } = lead;

  db.run(
    `
    INSERT INTO leads (id, name, company, email, value, source, createdAt, address, phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      name,
      company,
      email || null,
      value != null ? value : null,
      source || null,
      createdAt || new Date().toISOString(),
      address || null,
      phone || null,
    ],
    function (err) {
      if (err) {
        return callback(err);
      }
      callback(null);
    },
  );
}

function createActivity(activity, callback) {
  const { id, dealId, type, note, createdAt } = activity;
  db.run(
    `
    INSERT INTO activities (id, dealId, type, note, createdAt)
    VALUES (?, ?, ?, ?, ?)
    `,
    [id, dealId, type, note, createdAt],
    (err) => {
      if (err) {
        console.error('Error inserting activity:', err);
        return callback(err);
      }
      callback(null);
    },
  );
}

function getActivitiesForDeal(dealId, callback) {
  db.all(
    `
    SELECT * FROM activities
    WHERE dealId = ?
    ORDER BY datetime(createdAt) DESC
    `,
    [dealId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching activities:', err);
        return callback(err);
      }
      callback(null, rows);
    },
  );
}

function getRecentActivitiesForDeal(dealId, limit, callback) {
  const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : 5;
  db.all(
    `
    SELECT *
    FROM activities
    WHERE dealId = ?
    ORDER BY datetime(createdAt) DESC
    LIMIT ?
    `,
    [dealId, effectiveLimit],
    (err, rows) => {
      if (err) {
        console.error('Error fetching recent activities:', err);
        return callback(err);
      }
      callback(null, rows || []);
    },
  );
}

function updateDealStage(dealId, stage, callback) {
  db.run(
    `
    UPDATE deals
    SET stage = ?
    WHERE id = ?
    `,
    [stage, dealId],
    function (err) {
      if (err) {
        console.error('Error updating deal stage:', err);
        return callback(err);
      }

      db.get(
        `
        SELECT *
        FROM deals
        WHERE id = ?
        `,
        [dealId],
        (getErr, row) => {
          if (getErr) {
            console.error('Error loading updated deal:', getErr);
            return callback(getErr);
          }
          callback(null, row || null);
        },
      );
    },
  );
}

function createDeal(deal, callback) {
  const id = deal.id || uuidv4();
  const {
    leadId,
    title,
    stage = 'New',
    value = 0,
    nextAction = null,
    nextActionDate = null,
    reminderChannel = null,
    aiAutoReminderEnabled = 0,
  } = deal;

  db.run(
    `
    INSERT INTO deals (
      id,
      leadId,
      title,
      stage,
      value,
      nextAction,
      nextActionDate,
      reminderChannel,
      aiAutoReminderEnabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      leadId,
      title,
      stage,
      value,
      nextAction,
      nextActionDate,
      reminderChannel,
      aiAutoReminderEnabled ? 1 : 0,
    ],
    function (err) {
      if (err) {
        console.error('Error creating deal:', err);
        return callback(err);
      }

      db.get(
        `
        SELECT *
        FROM deals
        WHERE id = ?
        `,
        [id],
        (getErr, row) => {
          if (getErr) {
            console.error('Error fetching created deal:', getErr);
            return callback(getErr);
          }
          callback(null, row || null);
        },
      );
    },
  );
}

function updateDealDetails(dealId, details, callback) {
  const fields = [];
  const params = [];

  if (typeof details.value === 'number') {
    fields.push('value = ?');
    params.push(details.value);
  }

  if (typeof details.nextAction === 'string') {
    fields.push('nextAction = ?');
    params.push(details.nextAction);
  }

  if (Object.prototype.hasOwnProperty.call(details, 'nextActionDate')) {
    fields.push('nextActionDate = ?');
    params.push(details.nextActionDate);
  }

  if (fields.length === 0) {
    return callback(new Error('No fields to update'));
  }

  params.push(dealId);

  db.run(
    `
    UPDATE deals
    SET ${fields.join(', ')}
    WHERE id = ?
    `,
    params,
    function (err) {
      if (err) {
        console.error('Error updating deal details:', err);
        return callback(err);
      }

      db.get(
        `
        SELECT *
        FROM deals
        WHERE id = ?
        `,
        [dealId],
        (getErr, row) => {
          if (getErr) {
            console.error('Error loading updated deal details:', getErr);
            return callback(getErr);
          }
          callback(null, row || null);
        },
      );
    },
  );
}

function deleteLeadAndRelated(leadId, callback) {
  db.all(
    `
    SELECT id FROM deals WHERE leadId = ?
    `,
    [leadId],
    (err, dealRows) => {
      if (err) {
        console.error('Error loading deals for lead:', err);
        return callback(err);
      }

      const dealIds = dealRows.map((row) => row.id);

      db.serialize(() => {
        if (dealIds.length > 0) {
          const placeholders = dealIds.map(() => '?').join(', ');
          db.run(
            `
            DELETE FROM activities
            WHERE dealId IN (${placeholders})
            `,
            dealIds,
            (actErr) => {
              if (actErr) {
                console.error('Error deleting activities for lead:', actErr);
              }
            },
          );
        }

        db.run(
          `
          DELETE FROM deals
          WHERE leadId = ?
          `,
          [leadId],
          (dealErr) => {
            if (dealErr) {
              console.error('Error deleting deals for lead:', dealErr);
              return callback(dealErr);
            }

            db.run(
              `
              DELETE FROM leads
              WHERE id = ?
              `,
              [leadId],
              function (leadErr) {
                if (leadErr) {
                  console.error('Error deleting lead:', leadErr);
                  return callback(leadErr);
                }

                if (this.changes === 0) {
                  return callback(null, { notFound: true });
                }

                callback(null, { notFound: false });
              },
            );
          },
        );
      });
    },
  );
}

function seedDemoData() {
  db.get('SELECT COUNT(*) AS count FROM leads', (err, row) => {
    if (err) {
      console.error('Error counting leads for seed:', err);
      return;
    }
    if (row && row.count > 0) {
      return;
    }

    console.log('Seeding demo leads/deals into SQLite...');
    db.serialize(() => {
      // Leads
      db.run(
        'INSERT INTO leads (id, name, company, email, value, source, createdAt, address, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'lead-1',
          'Sarah Thompson',
          'Thompson Logistics',
          'sarah@thompsonlogistics.co.uk',
          12000,
          'Referral',
          '2025-11-20T09:15:00.000Z',
          'Unit 4, Riverside Park, Leeds',
          '+44 113 555 0123',
        ],
      );
      db.run(
        'INSERT INTO leads (id, name, company, email, value, source, createdAt, address, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'lead-2',
          'James Patel',
          'Patel & Co Accountants',
          'james@patelco.co.uk',
          8000,
          'LinkedIn',
          '2025-11-18T13:45:00.000Z',
          'Suite 12, City Gate, Manchester',
          '+44 161 555 0456',
        ],
      );
      db.run(
        'INSERT INTO leads (id, name, company, email, value, source, createdAt, address, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'lead-3',
          'Emily Carter',
          'Carter Retail Group',
          'emily.carter@carterretail.com',
          25000,
          'Website',
          '2025-11-10T10:30:00.000Z',
          'High Street 22, Birmingham',
          '+44 121 555 0789',
        ],
      );
      db.run(
        'INSERT INTO leads (id, name, company, email, value, source, createdAt, address, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'lead-4',
          'Michael Chen',
          'Chen Manufacturing',
          'michael.chen@chenmfg.com',
          18000,
          'Manual',
          '2025-11-05T16:20:00.000Z',
          'Industrial Estate Road 5, Sheffield',
          '+44 114 555 0110',
        ],
      );

      // Deals
      db.run(
        'INSERT INTO deals (id, leadId, title, stage, value, nextAction, nextActionDate, reminderChannel, aiAutoReminderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'deal-1',
          'lead-1',
          'AI dispatch optimisation',
          'Qualified',
          12000,
          'Schedule technical scoping call',
          '2025-12-03T10:00:00.000Z',
          'WhatsApp',
          1,
        ],
      );
      db.run(
        'INSERT INTO deals (id, leadId, title, stage, value, nextAction, nextActionDate, reminderChannel, aiAutoReminderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'deal-2',
          'lead-2',
          'Automation for monthly reporting',
          'New',
          8000,
          'Send follow-up with case studies',
          '2025-12-02T09:30:00.000Z',
          'SMS',
          0,
        ],
      );
      db.run(
        'INSERT INTO deals (id, leadId, title, stage, value, nextAction, nextActionDate, reminderChannel, aiAutoReminderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'deal-3',
          'lead-3',
          'Retail analytics revamp',
          'Proposal Sent',
          25000,
          'Review proposal with CFO',
          '2025-12-05T15:00:00.000Z',
          'WhatsApp',
          1,
        ],
      );
      db.run(
        'INSERT INTO deals (id, leadId, title, stage, value, nextAction, nextActionDate, reminderChannel, aiAutoReminderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'deal-4',
          'lead-4',
          'Factory workflow automation',
          'Qualified',
          18000,
          'Prepare pilot scope deck',
          '2025-12-04T11:00:00.000Z',
          'SMS',
          0,
        ],
      );
    });
  });
}

function getDealWithLead(dealId, callback) {
  db.get(
    `
    SELECT
      d.*,
      l.name AS leadName,
      l.company AS leadCompany,
      l.email AS leadEmail
    FROM deals d
    LEFT JOIN leads l ON l.id = d.leadId
    WHERE d.id = ?
    `,
    [dealId],
    (err, row) => {
      if (err) {
        return callback(err);
      }
      callback(null, row || null);
    },
  );
}

function getDealsWithLeadAndLastActivity(callback) {
  db.all(
    `
    SELECT
      d.*,
      l.name AS leadName,
      l.company AS leadCompany,
      l.email AS leadEmail,
      la.type AS lastActivityType,
      la.createdAt AS lastActivityDate
    FROM deals d
    LEFT JOIN leads l ON l.id = d.leadId
    LEFT JOIN (
      SELECT a.dealId, a.type, a.createdAt
      FROM activities a
      INNER JOIN (
        SELECT dealId, MAX(datetime(createdAt)) AS maxDate
        FROM activities
        GROUP BY dealId
      ) latest ON latest.dealId = a.dealId AND datetime(a.createdAt) = latest.maxDate
    ) la ON la.dealId = d.id
    `,
    [],
    (err, rows) => {
      if (err) {
        return callback(err);
      }
      callback(null, rows || []);
    },
  );
}

function getOutreachStepsForDeal(dealId, callback) {
  db.all(
    `
    SELECT *
    FROM outreach_steps
    WHERE dealId = ?
    ORDER BY datetime(dueDate) ASC, datetime(createdAt) ASC
    `,
    [dealId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching outreach steps:', err);
        return callback(err);
      }
      callback(null, rows || []);
    },
  );
}

function createOutreachSteps(steps, callback) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return callback(null);
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    let hasErrored = false;
    let remaining = steps.length;

    steps.forEach((step) => {
      if (hasErrored) {
        return;
      }

      const statusValue = step.status || 'pending';
      const completedAt = statusValue === 'pending' ? null : new Date().toISOString();
      const id = step.id || uuidv4();

      db.run(
        `
        INSERT INTO outreach_steps (
          id,
          dealId,
          dueDate,
          channel,
          intent,
          goal,
          status,
          completedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          step.dealId,
          step.dueDate,
          step.channel,
          step.intent,
          step.goal || null,
          statusValue,
          completedAt,
        ],
        (err) => {
          if (err) {
            hasErrored = true;
            console.error('Error inserting outreach step:', err);
            return db.run('ROLLBACK', () => callback(err));
          }

          remaining -= 1;
          if (remaining === 0 && !hasErrored) {
            db.run('COMMIT', (commitErr) => {
              if (commitErr) {
                console.error('Error committing outreach steps:', commitErr);
                return callback(commitErr);
              }
              callback(null);
            });
          }
        },
      );
    });
  });
}

function updateOutreachStepStatus(stepId, status, callback) {
  const completedAt = status === 'pending' ? null : new Date().toISOString();

  db.run(
    `
    UPDATE outreach_steps
    SET status = ?, completedAt = ?
    WHERE id = ?
    `,
    [status, completedAt, stepId],
    function (err) {
      if (err) {
        console.error('Error updating outreach step status:', err);
        return callback(err);
      }

      if (this.changes === 0) {
        return callback(null, { notFound: true });
      }

      callback(null, { notFound: false });
    },
  );
}

function getDealContextForMessageDraft(dealId, callback) {
  db.get(
    `
    SELECT
      d.id AS dealId,
      d.leadId,
      d.title AS dealName,
      d.stage,
      d.value AS valueGBP,
      d.nextAction,
      d.nextActionDate,
      l.name AS leadName,
      l.company,
      l.email,
      l.phone
    FROM deals d
    LEFT JOIN leads l ON l.id = d.leadId
    WHERE d.id = ?
    `,
    [dealId],
    (err, row) => {
      if (err) {
        console.error('Error fetching deal context:', err);
        return callback(err);
      }

      if (!row) {
        return callback(null, null);
      }

      db.get(
        `
        SELECT type, note, createdAt
        FROM activities
        WHERE dealId = ?
        ORDER BY datetime(createdAt) DESC
        LIMIT 1
        `,
        [dealId],
        (actErr, activity) => {
          if (actErr) {
            console.error('Error fetching last activity for deal:', actErr);
          }

          const context = {
            leadId: row.leadId,
            dealId: row.dealId,
            leadName: row.leadName || null,
            company: row.company || null,
            role: null,
            email: row.email || null,
            phone: row.phone || null,
            stage: row.stage || null,
            dealName: row.dealName || null,
            valueGBP: row.valueGBP != null ? Number(row.valueGBP) : null,
            productsOrServices: null,
            keyBenefits: null,
            lastActivityType: activity ? activity.type : null,
            lastActivityDate: activity ? activity.createdAt : null,
            lastActivityNotes: activity ? activity.note : null,
          };

          return callback(null, context);
        },
      );
    },
  );
}

module.exports = {
  db,
  initialiseDb,
  DB_PATH,
  createLead,
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
};
