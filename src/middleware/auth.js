const jwt = require('jsonwebtoken');
const { getTenant, checkTenantQuota } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'sec_jwt_disparozap_meta_9f83b271a0c45e8d91024bc682';

/**
 * Middleware para validar o token JWT
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer ')) 
    ? authHeader.split(' ')[1] 
    : (req.query.token || req.headers['x-access-token']);

  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Token de autenticação não fornecido.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // Se o usuário pertence a uma empresa (Tenant)
    if (decoded.tenantId) {
      const tenant = getTenant(decoded.tenantId);
      if (!tenant) {
        return res.status(403).json({ error: 'Empresa vinculada não encontrada ou desativada.' });
      }
      req.tenant = tenant;

      // Bloqueio se a empresa estiver suspensa
      if (tenant.status === 'SUSPENDED' && req.method !== 'GET') {
        return res.status(403).json({ 
          error: 'Esta conta está suspensa por pendência na assinatura. Entre em contato para reativar.',
          isSuspended: true
        });
      }
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessão expirada ou token inválido. Faça login novamente.' });
  }
}

/**
 * Middleware opcional (permite requisições públicas ou autenticadas)
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.split(' ')[1] : req.query.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      if (decoded.tenantId) {
        req.tenant = getTenant(decoded.tenantId);
      }
    } catch (_) {}
  }
  next();
}

/**
 * Middleware para restringir acesso apenas ao Super Admin (Dono da Plataforma)
 */
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'Acesso restrito apenas ao administrador do sistema.' });
  }
  next();
}

/**
 * Middleware para validar se a empresa ainda possui saldo/cota de mensagens no mês
 */
function checkQuota(req, res, next) {
  const tenantId = req.user?.tenantId || 1;
  const quota = checkTenantQuota(tenantId);

  if (!quota.canSend) {
    return res.status(403).json({
      error: quota.reason || 'Limite de disparos do seu plano foi atingido.',
      currentSent: quota.currentSent,
      monthlyLimit: quota.monthlyLimit,
      remaining: 0
    });
  }

  req.quota = quota;
  next();
}

module.exports = {
  JWT_SECRET,
  authenticateToken,
  optionalAuth,
  requireSuperAdmin,
  checkQuota
};
