const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { encryptToken, decryptToken } = require('../utils/crypto');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'disparo_meta.db');
const db = new Database(dbPath);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 1. TABELAS MULTI-TENANT SAAS
  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    price_cents INTEGER DEFAULT 0,
    monthly_limit INTEGER DEFAULT 5000,
    rate_limit_ms INTEGER DEFAULT 1000,
    allow_scheduler INTEGER DEFAULT 1,
    allow_template_builder INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    document TEXT,
    plan_id INTEGER DEFAULT 1,
    status TEXT DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, TRIAL, CANCELED
    monthly_limit INTEGER DEFAULT 5000,
    current_month_sent INTEGER DEFAULT 0,
    billing_cycle_start DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES plans(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'ADMIN', -- SUPERADMIN, ADMIN, OPERATOR
    status TEXT DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tenant_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER UNIQUE NOT NULL,
    phone_number_id TEXT,
    waba_id TEXT,
    display_phone_number TEXT,
    verified_name TEXT,
    access_token_encrypted TEXT,
    access_token_iv TEXT,
    access_token_tag TEXT,
    quality_rating TEXT DEFAULT 'GREEN',
    messaging_tier TEXT DEFAULT 'TIER_250',
    simulation_mode INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS consent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    campaign_id INTEGER,
    source TEXT NOT NULL,
    terms_version TEXT DEFAULT 'v1.0',
    ip_address TEXT,
    declared_by_user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  );

  -- 2. TABELAS DE CAMPANHAS E DISPAROS
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER DEFAULT 1,
    name TEXT NOT NULL,
    template_name TEXT NOT NULL,
    template_language TEXT DEFAULT 'pt_BR',
    total_contacts INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    read_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'DRAFT', -- DRAFT, SCHEDULED, RUNNING, PAUSED, COMPLETED, CANCELED
    delay_ms INTEGER DEFAULT 1000,
    parameters_mapping TEXT, -- JSON
    header_variable TEXT,
    scheduled_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS campaign_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER DEFAULT 1,
    campaign_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    name TEXT,
    custom_data TEXT,
    wamid TEXT UNIQUE,
    status TEXT DEFAULT 'PENDING',
    error_message TEXT,
    error_code TEXT,
    sent_at DATETIME,
    delivered_at DATETIME,
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS templates_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER DEFAULT 1,
    meta_id TEXT,
    name TEXT NOT NULL,
    language TEXT NOT NULL,
    category TEXT,
    status TEXT,
    components TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER DEFAULT 1,
    event_type TEXT,
    payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER DEFAULT 1,
    phone TEXT NOT NULL,
    name TEXT,
    reason TEXT,
    source TEXT DEFAULT 'MANUAL',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contact_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER DEFAULT 1,
    name TEXT NOT NULL,
    description TEXT,
    total_contacts INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contact_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER DEFAULT 1,
    list_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    name TEXT,
    custom_data TEXT,
    opt_in_source TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (list_id) REFERENCES contact_lists(id) ON DELETE CASCADE
  );
`);

// Migração segura para adicionar colunas em tabelas pré-existentes
function ensureColumnExists(table, column, typeDef) {
  try {
    const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all();
    const hasColumn = tableInfo.some(col => col.name === column);
    if (!hasColumn) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`).run();
    }
  } catch (err) {
    // Ignora se coluna já existir
  }
}

ensureColumnExists('campaigns', 'scheduled_at', 'DATETIME');
ensureColumnExists('campaigns', 'tenant_id', 'INTEGER DEFAULT 1');
ensureColumnExists('campaign_messages', 'tenant_id', 'INTEGER DEFAULT 1');
ensureColumnExists('templates_cache', 'tenant_id', 'INTEGER DEFAULT 1');
ensureColumnExists('blacklist', 'tenant_id', 'INTEGER DEFAULT 1');
ensureColumnExists('contact_lists', 'tenant_id', 'INTEGER DEFAULT 1');
ensureColumnExists('contact_list_items', 'tenant_id', 'INTEGER DEFAULT 1');
ensureColumnExists('contact_list_items', 'opt_in_source', 'TEXT');
ensureColumnExists('webhook_logs', 'tenant_id', 'INTEGER DEFAULT 1');

// Índices de performance multi-tenant
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_messages_tenant ON campaign_messages(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_blacklist_tenant_phone ON blacklist(tenant_id, phone);
  CREATE INDEX IF NOT EXISTS idx_contact_lists_tenant ON contact_lists(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_tenant_credentials_phone ON tenant_credentials(phone_number_id);
`);

// Helper functions for settings
function getSetting(key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at) 
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(key, value);
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// ----------------------------------------------------
// SEEDING DE DADOS INICIAIS SAAS
// ----------------------------------------------------
function seedInitialSaaSData() {
  // 1. Planos padrão
  const planCount = db.prepare('SELECT COUNT(*) as count FROM plans').get().count;
  if (planCount === 0) {
    const insertPlan = db.prepare(`
      INSERT INTO plans (name, code, price_cents, monthly_limit, rate_limit_ms, allow_scheduler, allow_template_builder)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertPlan.run('Starter', 'STARTER', 19700, 5000, 1500, 1, 1);
    insertPlan.run('Pro', 'PRO', 49700, 25000, 800, 1, 1);
    insertPlan.run('Enterprise', 'ENTERPRISE', 99700, 100000, 400, 1, 1);
  }

  // 2. Tenant padrão (Empresa 1)
  const tenantCount = db.prepare('SELECT COUNT(*) as count FROM tenants').get().count;
  if (tenantCount === 0) {
    db.prepare(`
      INSERT INTO tenants (id, name, document, plan_id, status, monthly_limit, current_month_sent)
      VALUES (1, 'Empresa Principal', '00.000.000/0001-00', 2, 'ACTIVE', 25000, 0)
    `).run();
  }

  // 3. Usuários Padrão (Super Admin e Admin do Tenant)
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const salt = bcrypt.genSaltSync(10);
    const hashAdmin = bcrypt.hashSync('admin123', salt);
    const hashClient = bcrypt.hashSync('cliente123', salt);

    // Super Admin (proprietário do SaaS)
    db.prepare(`
      INSERT INTO users (tenant_id, name, email, password_hash, role, status)
      VALUES (NULL, 'Super Administrador', 'admin@disparozap.com', ?, 'SUPERADMIN', 'ACTIVE')
    `).run(hashAdmin);

    // Administrador do Tenant 1
    db.prepare(`
      INSERT INTO users (tenant_id, name, email, password_hash, role, status)
      VALUES (1, 'Gestor da Empresa', 'cliente@empresa.com', ?, 'ADMIN', 'ACTIVE')
    `).run(hashClient);
  }

  // 4. Migração de credenciais existentes para o tenant 1 com criptografia AES-256
  const credsCount = db.prepare('SELECT COUNT(*) as count FROM tenant_credentials WHERE tenant_id = 1').get().count;
  if (credsCount === 0) {
    const token = getSetting('meta_access_token');
    const phoneId = getSetting('meta_phone_number_id');
    const wabaId = getSetting('meta_waba_id');
    const isSim = getSetting('simulation_mode') === 'true' ? 1 : 0;

    let enc = null;
    if (token) {
      enc = encryptToken(token);
    }

    db.prepare(`
      INSERT INTO tenant_credentials (
        tenant_id, phone_number_id, waba_id,
        access_token_encrypted, access_token_iv, access_token_tag,
        simulation_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      1,
      phoneId || null,
      wabaId || null,
      enc ? enc.encrypted : null,
      enc ? enc.iv : null,
      enc ? enc.tag : null,
      isSim
    );
  }
}

seedInitialSaaSData();

// ----------------------------------------------------
// SAAS TENANT & CREDENTIAL HELPERS
// ----------------------------------------------------
function getTenant(tenantId) {
  return db.prepare(`
    SELECT t.*, p.name as plan_name, p.code as plan_code, p.rate_limit_ms, p.allow_scheduler
    FROM tenants t
    LEFT JOIN plans p ON p.id = t.plan_id
    WHERE t.id = ?
  `).get(tenantId);
}

function getAllTenants() {
  return db.prepare(`
    SELECT t.*, p.name as plan_name, p.code as plan_code,
           (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as user_count,
           (SELECT COUNT(*) FROM campaigns WHERE tenant_id = t.id) as campaign_count
    FROM tenants t
    LEFT JOIN plans p ON p.id = t.plan_id
    ORDER BY t.created_at DESC
  `).all();
}

function createTenant({ name, document = '', planId = 1, monthlyLimit = 5000 }) {
  const stmt = db.prepare(`
    INSERT INTO tenants (name, document, plan_id, status, monthly_limit, current_month_sent, created_at, updated_at)
    VALUES (?, ?, ?, 'ACTIVE', ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const result = stmt.run(name, document, planId, monthlyLimit);
  return result.lastInsertRowid;
}

function updateTenant(tenantId, fields = {}) {
  const allowed = ['name', 'document', 'plan_id', 'status', 'monthly_limit', 'current_month_sent'];
  const sets = [];
  const params = [];

  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
  }

  if (sets.length === 0) return;
  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(tenantId);

  db.prepare(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

function getTenantCredentials(tenantId) {
  const row = db.prepare('SELECT * FROM tenant_credentials WHERE tenant_id = ?').get(tenantId);
  if (!row) return null;

  let accessToken = null;
  if (row.access_token_encrypted && row.access_token_iv && row.access_token_tag) {
    accessToken = decryptToken(row.access_token_encrypted, row.access_token_iv, row.access_token_tag);
  }

  return {
    ...row,
    accessToken,
    simulationMode: !!row.simulation_mode
  };
}

function saveTenantCredentials(tenantId, creds = {}) {
  let enc = null;
  if (creds.accessToken) {
    enc = encryptToken(creds.accessToken);
  }

  const existing = db.prepare('SELECT id FROM tenant_credentials WHERE tenant_id = ?').get(tenantId);

  if (existing) {
    let updateSql = `
      UPDATE tenant_credentials SET
        phone_number_id = COALESCE(?, phone_number_id),
        waba_id = COALESCE(?, waba_id),
        display_phone_number = COALESCE(?, display_phone_number),
        verified_name = COALESCE(?, verified_name),
        quality_rating = COALESCE(?, quality_rating),
        messaging_tier = COALESCE(?, messaging_tier),
        simulation_mode = COALESCE(?, simulation_mode),
        updated_at = CURRENT_TIMESTAMP
    `;
    const params = [
      creds.phoneNumberId || null,
      creds.wabaId || null,
      creds.displayPhoneNumber || null,
      creds.verifiedName || null,
      creds.qualityRating || null,
      creds.messagingTier || null,
      creds.simulationMode !== undefined ? (creds.simulationMode ? 1 : 0) : null
    ];

    if (enc) {
      updateSql += `, access_token_encrypted = ?, access_token_iv = ?, access_token_tag = ?`;
      params.push(enc.encrypted, enc.iv, enc.tag);
    }

    updateSql += ' WHERE tenant_id = ?';
    params.push(tenantId);
    db.prepare(updateSql).run(...params);
  } else {
    db.prepare(`
      INSERT INTO tenant_credentials (
        tenant_id, phone_number_id, waba_id, display_phone_number, verified_name,
        access_token_encrypted, access_token_iv, access_token_tag,
        quality_rating, messaging_tier, simulation_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tenantId,
      creds.phoneNumberId || null,
      creds.wabaId || null,
      creds.displayPhoneNumber || null,
      creds.verifiedName || null,
      enc ? enc.encrypted : null,
      enc ? enc.iv : null,
      enc ? enc.tag : null,
      creds.qualityRating || 'GREEN',
      creds.messagingTier || 'TIER_250',
      creds.simulationMode ? 1 : 0
    );
  }
}

function getTenantByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;
  const row = db.prepare(`
    SELECT t.*, tc.phone_number_id, tc.waba_id, tc.access_token_encrypted, tc.access_token_iv, tc.access_token_tag, tc.simulation_mode
    FROM tenant_credentials tc
    JOIN tenants t ON t.id = tc.tenant_id
    WHERE tc.phone_number_id = ?
  `).get(String(phoneNumberId));

  if (!row) return null;

  let accessToken = null;
  if (row.access_token_encrypted && row.access_token_iv && row.access_token_tag) {
    accessToken = decryptToken(row.access_token_encrypted, row.access_token_iv, row.access_token_tag);
  }

  return {
    ...row,
    accessToken,
    simulationMode: !!row.simulation_mode
  };
}

function checkTenantQuota(tenantId) {
  const tenant = getTenant(tenantId);
  if (!tenant) return { canSend: false, reason: 'Empresa não encontrada' };

  if (tenant.status !== 'ACTIVE') {
    return { canSend: false, reason: `Assinatura ${tenant.status}. Contate o suporte.` };
  }

  const remaining = Math.max(0, (tenant.monthly_limit || 0) - (tenant.current_month_sent || 0));
  return {
    canSend: remaining > 0,
    currentSent: tenant.current_month_sent || 0,
    monthlyLimit: tenant.monthly_limit || 0,
    remaining,
    reason: remaining > 0 ? null : 'Limite mensal de disparos do plano atingido'
  };
}

function incrementTenantSent(tenantId, count = 1) {
  db.prepare(`
    UPDATE tenants
    SET current_month_sent = current_month_sent + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(count, tenantId);
}

// ----------------------------------------------------
// USER AUTH HELPERS
// ----------------------------------------------------
function getUserByEmail(email) {
  return db.prepare(`
    SELECT u.*, t.name as tenant_name, t.status as tenant_status, t.plan_id
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE LOWER(u.email) = LOWER(?)
  `).get(email);
}

function createUser({ tenantId = null, name, email, password, role = 'ADMIN' }) {
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(password, salt);
  const stmt = db.prepare(`
    INSERT INTO users (tenant_id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE')
  `);
  const result = stmt.run(tenantId, name, email.toLowerCase().trim(), hash, role);
  return result.lastInsertRowid;
}

// ----------------------------------------------------
// BLACKLIST / OPT-OUT HELPERS (ISOLADAS POR TENANT)
// ----------------------------------------------------
function isPhoneBlacklisted(phone, tenantId = 1) {
  if (!phone) return false;
  const clean = String(phone).replace(/\D/g, '');
  const row = db.prepare('SELECT id FROM blacklist WHERE tenant_id = ? AND (phone = ? OR phone = ?)').get(tenantId, clean, phone);
  return !!row;
}

function addToBlacklist(phone, name = '', reason = 'Opt-out solicitado', source = 'MANUAL', tenantId = 1) {
  if (!phone) return null;
  const clean = String(phone).replace(/\D/g, '');
  const stmt = db.prepare(`
    INSERT INTO blacklist (tenant_id, phone, name, reason, source, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  return stmt.run(tenantId, clean, name, reason, source);
}

function removeFromBlacklist(phone, tenantId = 1) {
  const clean = String(phone).replace(/\D/g, '');
  return db.prepare('DELETE FROM blacklist WHERE tenant_id = ? AND (phone = ? OR phone = ?)').run(tenantId, clean, phone);
}

function getBlacklist(tenantId = 1, limit = 100, offset = 0, search = '') {
  let query = 'SELECT * FROM blacklist WHERE tenant_id = ?';
  const params = [tenantId];
  if (search) {
    query += ' AND (phone LIKE ? OR name LIKE ? OR reason LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(query).all(...params);
}

module.exports = {
  db,
  getSetting,
  setSetting,
  getAllSettings,
  // Multi-tenant & Auth
  getTenant,
  getAllTenants,
  createTenant,
  updateTenant,
  getTenantCredentials,
  saveTenantCredentials,
  getTenantByPhoneNumberId,
  checkTenantQuota,
  incrementTenantSent,
  getUserByEmail,
  createUser,
  // Blacklist
  isPhoneBlacklisted,
  addToBlacklist,
  removeFromBlacklist,
  getBlacklist
};
