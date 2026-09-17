const express = require('express');
const router = express.Router();
const { getSetting, db } = require('../db/database');
const metaService = require('../services/metaService');

// Verificação do Webhook pela Meta (GET)
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const configuredToken = getSetting('meta_verify_token');

  if (mode === 'subscribe' && token === configuredToken) {
    console.log('✅ Webhook verificado com sucesso pela Meta!');
    return res.status(200).send(challenge);
  } else {
    console.warn('⚠️ Falha na verificação do Webhook: token inválido ou modo incorreto.');
    return res.sendStatus(403);
  }
});

// Recebimento de eventos e atualizações de status da Meta (POST) com multiplexing multi-tenant
router.post('/', (req, res) => {
  try {
    const payload = req.body;
    const signatureHeader = req.headers['x-hub-signature-256'];

    // Registra log do webhook
    try {
      db.prepare('INSERT INTO webhook_logs (event_type, payload) VALUES (?, ?)')
        .run('messages_status', JSON.stringify(payload));
    } catch (_) {}

    // Processa atualização dos status e opt-out com identificação da empresa
    metaService.processWebhook(payload, JSON.stringify(payload), signatureHeader);

    // A Meta exige resposta 200 rápida
    res.status(200).json({ status: 'success' });
  } catch (err) {
    console.error('Erro ao processar webhook:', err);
    res.status(200).json({ status: 'error_logged' });
  }
});

// Listar últimos logs de webhook recebidos (para depuração)
router.get('/logs', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const logs = db.prepare('SELECT * FROM webhook_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50').all(tenantId);
    res.json(logs.map(l => ({ ...l, payload: JSON.parse(l.payload || '{}') })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
