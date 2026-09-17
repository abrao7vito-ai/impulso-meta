const express = require('express');
const router = express.Router();
const { getAllSettings, setSetting, getTenantCredentials, saveTenantCredentials } = require('../db/database');
const metaService = require('../services/metaService');

// Obter configurações atuais da empresa logada
router.get('/', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const creds = getTenantCredentials(tenantId);
    const settings = getAllSettings();

    res.json({
      meta_access_token: (creds && creds.accessToken) || settings.meta_access_token || '',
      meta_phone_number_id: (creds && creds.phone_number_id) || settings.meta_phone_number_id || '',
      meta_waba_id: (creds && creds.waba_id) || settings.meta_waba_id || '',
      meta_api_version: settings.meta_api_version || 'v21.0',
      meta_verify_token: settings.meta_verify_token || '',
      simulation_mode: creds ? creds.simulationMode : (settings.simulation_mode === 'true'),
      default_delay_ms: parseInt(settings.default_delay_ms) || 1000,
      details: creds ? {
        displayPhoneNumber: creds.display_phone_number,
        verifiedName: creds.verified_name,
        qualityRating: creds.quality_rating,
        messagingTier: creds.messaging_tier
      } : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Salvar configurações com criptografia de token AES-256
router.post('/', (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const {
      meta_access_token,
      meta_phone_number_id,
      meta_waba_id,
      meta_api_version,
      meta_verify_token,
      simulation_mode,
      default_delay_ms
    } = req.body;

    // Salva no tenant com criptografia
    saveTenantCredentials(tenantId, {
      accessToken: meta_access_token !== undefined ? meta_access_token.trim() : undefined,
      phoneNumberId: meta_phone_number_id !== undefined ? meta_phone_number_id.trim() : undefined,
      wabaId: meta_waba_id !== undefined ? meta_waba_id.trim() : undefined,
      simulationMode: simulation_mode !== undefined ? (String(simulation_mode) === 'true') : undefined
    });

    // Mantém sincronizado no settings global para retrocompatibilidade
    if (meta_access_token !== undefined) setSetting('meta_access_token', meta_access_token.trim());
    if (meta_phone_number_id !== undefined) setSetting('meta_phone_number_id', meta_phone_number_id.trim());
    if (meta_waba_id !== undefined) setSetting('meta_waba_id', meta_waba_id.trim());
    if (meta_api_version !== undefined) setSetting('meta_api_version', meta_api_version.trim());
    if (meta_verify_token !== undefined) setSetting('meta_verify_token', meta_verify_token.trim());
    if (simulation_mode !== undefined) setSetting('simulation_mode', String(simulation_mode));
    if (default_delay_ms !== undefined) setSetting('default_delay_ms', String(default_delay_ms));

    res.json({ success: true, message: 'Configurações atualizadas com sucesso e token criptografado!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Testar conexão com a Meta Graph API
router.post('/test-connection', async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || 1;
    const result = await metaService.testConnection(req.body, tenantId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
