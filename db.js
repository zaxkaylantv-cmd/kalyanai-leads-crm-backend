const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

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

module.exports = { db, initialiseDb, DB_PATH, createLead, getDealWithLead };
