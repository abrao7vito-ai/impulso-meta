const express = require('express');
const router = express.Router();
const { db, getAllTenants, getTenant, createTenant, updateTenant, createUser } = require('../db/database');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');

// Todas as rotas neste arquivo exigem autenticação de Super Admin
router.use(authenticateToken, requireSuperAdmin);

// 1. Visão Geral da Plataforma (Métricas Globais)
router.get('/overview', (req, res) => {
  try {
    const tenants = getAllTenants();
    const totalTenants = tenants.length;
    const activeTenants = tenants.filter(t => t.status === 'ACTIVE').length;
    const suspendedTenants = tenants.filter(t => t.status === 'SUSPENDED').length;

    const totalSentMonth = tenants.reduce((acc, t) => acc + (t.current_month_sent || 0), 0);
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalCampaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns').get().count;

    const plans = db.prepare('SELECT * FROM plans WHERE is_active = 1').all();

    res.json({
      metrics: {
        totalTenants,
        activeTenants,
        suspendedTenants,
        totalSentMonth,
        totalUsers,
        totalCampaigns
      },
      plans,
      recentTenants: tenants.slice(0, 10)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Listar todas as empresas
router.get('/tenants', (req, res) => {
  try {
    const tenants = getAllTenants();
    res.json(tenants);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Criar nova empresa cliente (Tenant) com usuário inicial
router.post('/tenants', (req, res) => {
  try {
    const { name, document, planId = 1, monthlyLimit, adminName, adminEmail, adminPassword } = req.body;

    if (!name || !adminEmail || !adminPassword) {
      return res.status(400).json({ error: 'Nome da empresa, e-mail e senha do administrador são obrigatórios.' });
    }

    // Valida se o email já está em uso
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(adminEmail.trim());
    if (existing) {
      return res.status(400).json({ error: 'Já existe um usuário cadastrado com este e-mail.' });
    }

    // Determina limite de mensagens baseado no plano se não especificado
    let limit = monthlyLimit;
    if (!limit) {
      const plan = db.prepare('SELECT monthly_limit FROM plans WHERE id = ?').get(planId);
      limit = plan ? plan.monthly_limit : 5000;
    }

    // Cria o tenant
    const tenantId = createTenant({
      name,
      document,
      planId: parseInt(planId),
      monthlyLimit: parseInt(limit)
    });

    // Cria o usuário gestor do tenant
    const userId = createUser({
      tenantId,
      name: adminName || `Gestor ${name}`,
      email: adminEmail.trim(),
      password: adminPassword,
      role: 'ADMIN'
    });

    res.json({
      success: true,
      tenantId,
      userId,
      message: `Empresa "${name}" criada com sucesso.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Detalhes de uma empresa específica
router.get('/tenants/:id', (req, res) => {
  try {
    const tenant = getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada.' });

    const users = db.prepare('SELECT id, name, email, role, status, created_at FROM users WHERE tenant_id = ?').all(req.params.id);
    const campaigns = db.prepare('SELECT id, name, status, sent_count, total_contacts, created_at FROM campaigns WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 10').all(req.params.id);

    res.json({
      tenant,
      users,
      recentCampaigns: campaigns
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Atualizar empresa (plano, limite, nome)
router.put('/tenants/:id', (req, res) => {
  try {
    updateTenant(req.params.id, req.body);
    res.json({ success: true, message: 'Dados da empresa atualizados com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Suspender ou Ativar Empresa (Ação Rápida com 1 clique)
router.post('/tenants/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!['ACTIVE', 'SUSPENDED', 'TRIAL', 'CANCELED'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido. Use ACTIVE, SUSPENDED, TRIAL ou CANCELED.' });
    }

    updateTenant(req.params.id, { status });

    // Se suspender, pausa campanhas em execução imediatamente
    if (status === 'SUSPENDED') {
      db.prepare("UPDATE campaigns SET status = 'PAUSED' WHERE tenant_id = ? AND status IN ('RUNNING', 'SCHEDULED')").run(req.params.id);
    }

    res.json({
      success: true,
      message: `Empresa ${status === 'SUSPENDED' ? 'suspensa' : 'ativada'} com sucesso.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Resetar cota mensal de mensagens
router.post('/tenants/:id/reset-quota', (req, res) => {
  try {
    updateTenant(req.params.id, { current_month_sent: 0 });
    res.json({ success: true, message: 'Consumo mensal zerado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Listar e gerenciar Planos
router.get('/plans', (req, res) => {
  try {
    const plans = db.prepare('SELECT * FROM plans ORDER BY price_cents ASC').all();
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
