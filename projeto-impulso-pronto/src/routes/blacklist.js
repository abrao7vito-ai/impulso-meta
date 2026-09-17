const express = require('express');
const router = express.Router();
const { getBlacklist, addToBlacklist, removeFromBlacklist } = require('../db/database');
const { sanitizePhoneNumber } = require('../utils/phone');

// Listar números na lista negra / opt-out da empresa
router.get('/', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';

    const list = getBlacklist(tenantId, limit, offset, search);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Adicionar número manualmente na lista negra da empresa
router.post('/', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const { phone, name = '', reason = 'Bloqueado manualmente' } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Número de telefone é obrigatório.' });
    }

    const check = sanitizePhoneNumber(phone);
    const targetPhone = check.isValid ? check.formatted : phone.replace(/\D/g, '');

    addToBlacklist(targetPhone, name, reason, 'MANUAL', tenantId);
    res.json({ success: true, message: `Número ${targetPhone} adicionado à Lista Negra com sucesso!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remover número da lista negra da empresa
router.delete('/:phone', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const phone = req.params.phone;
    removeFromBlacklist(phone, tenantId);
    res.json({ success: true, message: `Número removido da Lista Negra.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
