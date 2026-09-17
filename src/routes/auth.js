const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getUserByEmail, getTenant, checkTenantQuota } = require('../db/database');
const { JWT_SECRET, authenticateToken } = require('../middleware/auth');

// Login de Usuários (Super Admin e Clientes)
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    const user = getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Usuário desativado. Contate o administrador.' });
    }

    const isValidPassword = bcrypt.compareSync(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    // Busca detalhes do tenant se não for Super Admin
    let tenantInfo = null;
    let quota = null;
    if (user.tenant_id) {
      tenantInfo = getTenant(user.tenant_id);
      quota = checkTenantQuota(user.tenant_id);
    }

    const tokenPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenant_id
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenant_id,
        tenantName: tenantInfo ? tenantInfo.name : 'Plataforma Geral',
        tenantStatus: tenantInfo ? tenantInfo.status : 'ACTIVE',
        plan: tenantInfo ? tenantInfo.plan_name : 'SuperAdmin',
        quota
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obter dados do usuário logado e cota da assinatura
router.get('/me', authenticateToken, (req, res) => {
  try {
    let tenantInfo = null;
    let quota = null;

    if (req.user.tenantId) {
      tenantInfo = getTenant(req.user.tenantId);
      quota = checkTenantQuota(req.user.tenantId);
    }

    res.json({
      user: req.user,
      tenant: tenantInfo,
      quota
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
