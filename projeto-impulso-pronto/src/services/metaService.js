const axios = require('axios');
const { 
  getSetting, 
  setSetting, 
  db, 
  addToBlacklist, 
  getTenantCredentials, 
  getTenantByPhoneNumberId, 
  saveTenantCredentials 
} = require('../db/database');
const { verifyMetaSignature } = require('../utils/crypto');

class MetaService {
  /**
   * Obtém as credenciais ativas do tenant ou das configurações globais
   */
  getCredentials(overrides = {}, tenantId = 1) {
    let tenantCreds = null;
    if (tenantId) {
      tenantCreds = getTenantCredentials(tenantId);
    }

    const accessToken = overrides.accessToken || 
      (tenantCreds && tenantCreds.accessToken) || 
      getSetting('meta_access_token') || 
      process.env.META_ACCESS_TOKEN || '';

    const phoneNumberId = overrides.phoneNumberId || 
      (tenantCreds && tenantCreds.phone_number_id) || 
      getSetting('meta_phone_number_id') || 
      process.env.META_PHONE_NUMBER_ID || '';

    const wabaId = overrides.wabaId || 
      (tenantCreds && tenantCreds.waba_id) || 
      getSetting('meta_waba_id') || 
      process.env.META_WABA_ID || '';

    const apiVersion = overrides.apiVersion || 
      getSetting('meta_api_version') || 
      process.env.META_API_VERSION || 'v21.0';

    let simulationMode = false;
    if (overrides.simulationMode !== undefined) {
      simulationMode = String(overrides.simulationMode) === 'true';
    } else if (tenantCreds && tenantCreds.simulationMode !== undefined) {
      simulationMode = !!tenantCreds.simulationMode;
    } else {
      simulationMode = getSetting('simulation_mode', 'true') === 'true';
    }

    return {
      accessToken,
      phoneNumberId,
      wabaId,
      apiVersion,
      simulationMode
    };
  }

  /**
   * Testa a conexão com a Graph API e obtém detalhes do número e da conta WABA
   */
  async testConnection(customCreds = {}, tenantId = 1) {
    const creds = this.getCredentials(customCreds, tenantId);

    if (creds.simulationMode) {
      return {
        success: true,
        simulation: true,
        message: 'Modo de Simulação Ativo (Sandbox)',
        details: {
          displayPhoneNumber: '+55 (11) 99999-0000 (Simulado)',
          verifiedName: 'Empresa Teste Sandbox',
          qualityRating: 'GREEN (Alta)',
          messagingLimitTier: 'TIER_10K (10.000 msgs/dia)',
          wabaName: 'WhatsApp Business Sandbox',
          apiVersion: creds.apiVersion
        }
      };
    }

    if (!creds.accessToken || !creds.phoneNumberId) {
      throw new Error('Access Token e Phone Number ID são obrigatórios.');
    }

    const headers = {
      Authorization: `Bearer ${creds.accessToken}`
    };

    try {
      // 1. Consulta detalhes do número de telefone
      const phoneUrl = `https://graph.facebook.com/${creds.apiVersion}/${creds.phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status,messaging_limit_tier`;
      const phoneRes = await axios.get(phoneUrl, { headers });

      let wabaDetails = {};
      if (creds.wabaId) {
        try {
          const wabaUrl = `https://graph.facebook.com/${creds.apiVersion}/${creds.wabaId}?fields=name,currency,timezone_id`;
          const wabaRes = await axios.get(wabaUrl, { headers });
          wabaDetails = wabaRes.data;
        } catch (wabaErr) {
          console.warn('Aviso: Não foi possível obter dados do WABA ID:', wabaErr.response?.data || wabaErr.message);
        }
      }

      // Atualiza os dados verificados no tenant
      if (tenantId) {
        saveTenantCredentials(tenantId, {
          displayPhoneNumber: phoneRes.data.display_phone_number,
          verifiedName: phoneRes.data.verified_name,
          qualityRating: phoneRes.data.quality_rating || 'GREEN',
          messagingTier: phoneRes.data.messaging_limit_tier || 'TIER_250'
        });
      }

      return {
        success: true,
        simulation: false,
        message: 'Conexão com a Meta Graph API estabelecida com sucesso!',
        details: {
          displayPhoneNumber: phoneRes.data.display_phone_number,
          verifiedName: phoneRes.data.verified_name,
          qualityRating: phoneRes.data.quality_rating || 'UNKNOWN',
          codeVerificationStatus: phoneRes.data.code_verification_status,
          messagingLimitTier: phoneRes.data.messaging_limit_tier || 'N/A',
          wabaName: wabaDetails.name || 'Conta WABA Verificada',
          apiVersion: creds.apiVersion
        }
      };
    } catch (error) {
      const metaError = error.response?.data?.error;
      const message = metaError 
        ? `[${metaError.code}] ${metaError.message}`
        : error.message;
      throw new Error(`Falha na autenticação da Meta: ${message}`);
    }
  }

  /**
   * Sincroniza e armazena os templates aprovados da WABA
   */
  async syncTemplates(tenantId = 1) {
    const creds = this.getCredentials({}, tenantId);

    if (creds.simulationMode || !creds.wabaId || !creds.accessToken) {
      // Templates simulados padrão
      const mockTemplates = [
        {
          name: 'confirmacao_pedido',
          language: 'pt_BR',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [
            { type: 'HEADER', format: 'TEXT', text: 'Confirmação do Pedido #{{2}}' },
            { type: 'BODY', text: 'Olá {{1}}! Seu pedido {{2}} no valor de {{3}} foi confirmado com sucesso.' },
            { type: 'FOOTER', text: 'Agradecemos a sua preferência!' }
          ]
        },
        {
          name: 'lembrete_vencimento',
          language: 'pt_BR',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [
            { type: 'HEADER', format: 'TEXT', text: 'Lembrete de Vencimento' },
            { type: 'BODY', text: 'Olá {{1}}, informamos que sua fatura no valor de {{2}} vence em {{3}}. Acesse o link para pagamento.' },
            { type: 'FOOTER', text: 'Evite juros pagando até o vencimento.' }
          ]
        },
        {
          name: 'hello_world',
          language: 'en_US',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [
            { type: 'BODY', text: 'Welcome and congratulations! This message demonstrates your WhatsApp Cloud API integration.' }
          ]
        }
      ];

      const stmt = db.prepare(`
        INSERT INTO templates_cache (tenant_id, name, language, category, status, components, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(name, language) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          category = excluded.category,
          status = excluded.status,
          components = excluded.components,
          updated_at = CURRENT_TIMESTAMP
      `);

      for (const tpl of mockTemplates) {
        stmt.run(tenantId, tpl.name, tpl.language, tpl.category, tpl.status, JSON.stringify(tpl.components));
      }

      return { count: mockTemplates.length, templates: mockTemplates, isSimulated: true };
    }

    try {
      const url = `https://graph.facebook.com/${creds.apiVersion}/${creds.wabaId}/message_templates?limit=100`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${creds.accessToken}` }
      });

      const templates = res.data.data || [];

      const stmt = db.prepare(`
        INSERT INTO templates_cache (tenant_id, meta_id, name, language, category, status, components, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(name, language) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          meta_id = excluded.meta_id,
          category = excluded.category,
          status = excluded.status,
          components = excluded.components,
          updated_at = CURRENT_TIMESTAMP
      `);

      const insertMany = db.transaction((items) => {
        for (const t of items) {
          stmt.run(tenantId, t.id, t.name, t.language, t.category, t.status, JSON.stringify(t.components));
        }
      });

      insertMany(templates);

      return { count: templates.length, templates, isSimulated: false };
    } catch (error) {
      const metaError = error.response?.data?.error;
      const message = metaError 
        ? `[${metaError.code}] ${metaError.message}`
        : error.message;
      throw new Error(`Erro ao sincronizar templates da Meta: ${message}`);
    }
  }

  /**
   * Retorna os templates cacheados da empresa
   */
  getCachedTemplates(tenantId = 1) {
    const rows = db.prepare('SELECT * FROM templates_cache WHERE tenant_id = ? ORDER BY name ASC').all(tenantId);
    return rows.map(r => ({
      id: r.id,
      metaId: r.meta_id,
      name: r.name,
      language: r.language,
      category: r.category,
      status: r.status,
      components: JSON.parse(r.components || '[]')
    }));
  }

  /**
   * Envia uma mensagem baseada em template oficial
   */
  async sendTemplateMessage({
    to,
    templateName,
    languageCode = 'pt_BR',
    headerParameters = [],
    bodyParameters = [],
    buttonParameters = []
  }, tenantId = 1) {
    const creds = this.getCredentials({}, tenantId);

    // MODO SIMULAÇÃO (SANDBOX)
    if (creds.simulationMode) {
      const mockWamid = `wamid.SIMULATED_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      return {
        success: true,
        isSimulated: true,
        messageId: mockWamid,
        details: { to, templateName, languageCode }
      };
    }

    if (!creds.accessToken || !creds.phoneNumberId) {
      throw new Error('Credenciais da Meta não configuradas para esta empresa.');
    }

    // Monta componentes dinâmicos da mensagem
    const components = [];

    if (headerParameters && headerParameters.length > 0) {
      components.push({
        type: 'header',
        parameters: headerParameters.map(val => ({
          type: 'text',
          text: String(val)
        }))
      });
    }

    if (bodyParameters && bodyParameters.length > 0) {
      components.push({
        type: 'body',
        parameters: bodyParameters.map(val => ({
          type: 'text',
          text: String(val)
        }))
      });
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(to),
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode
        },
        ...(components.length > 0 ? { components } : {})
      }
    };

    const url = `https://graph.facebook.com/${creds.apiVersion}/${creds.phoneNumberId}/messages`;

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const messageId = response.data?.messages?.[0]?.id;
      return {
        success: true,
        isSimulated: false,
        messageId,
        rawResponse: response.data
      };
    } catch (error) {
      const metaError = error.response?.data?.error;
      const message = metaError 
        ? `[${metaError.code}] ${metaError.message} (Detalhe: ${metaError.error_data?.details || metaError.error_user_msg || 'sem detalhes'})`
        : error.message;

      return {
        success: false,
        isSimulated: false,
        error: message,
        errorCode: metaError?.code || 'UNKNOWN',
        rawResponse: error.response?.data
      };
    }
  }

  /**
   * Processa Webhooks da Meta com Multiplexing de Tenants e Verificação de Assinatura
   */
  processWebhook(body, rawBody = '', signatureHeader = '') {
    if (!body || !body.entry) return { processed: 0 };

    // Valida assinatura HMAC-SHA256 se META_APP_SECRET estiver configurado
    if (process.env.META_APP_SECRET && signatureHeader) {
      const isValid = verifyMetaSignature(rawBody, signatureHeader, process.env.META_APP_SECRET);
      if (!isValid) {
        console.warn('⚠️ Alerta de Segurança: Assinatura do Webhook Meta inválida (X-Hub-Signature-256 rejeitada).');
        return { processed: 0, error: 'Assinatura inválida' };
      }
    }

    let processedCount = 0;

    for (const entry of body.entry) {
      for (const change of entry.changes || []) {
        if (change.field === 'messages') {
          const value = change.value;
          const metadata = value?.metadata || {};
          const phoneNumberId = metadata.phone_number_id;

          // Roteamento inteligente do Tenant dono da mensagem
          let tenantId = 1;
          if (phoneNumberId) {
            const tenantInfo = getTenantByPhoneNumberId(phoneNumberId);
            if (tenantInfo) {
              tenantId = tenantInfo.id;
            }
          }

          // 1. Atualizações de Status (Enviada, Entregue, Lida, Falha)
          const statuses = value?.statuses || [];
          for (const statusObj of statuses) {
            const wamid = statusObj.id;
            const newStatus = statusObj.status?.toUpperCase();
            const timestamp = statusObj.timestamp 
              ? new Date(parseInt(statusObj.timestamp) * 1000).toISOString()
              : new Date().toISOString();

            if (!wamid || !newStatus) continue;

            const existing = db.prepare('SELECT id, campaign_id, status FROM campaign_messages WHERE wamid = ?').get(wamid);
            if (existing) {
              let updateSql = 'UPDATE campaign_messages SET status = ?';
              const params = [newStatus];

              if (newStatus === 'DELIVERED') {
                updateSql += ', delivered_at = ?';
                params.push(timestamp);
              } else if (newStatus === 'READ') {
                updateSql += ', read_at = ?';
                params.push(timestamp);
              } else if (newStatus === 'FAILED') {
                const errObj = statusObj.errors?.[0];
                updateSql += ', error_message = ?, error_code = ?';
                params.push(errObj?.message || 'Falha na entrega', String(errObj?.code || ''));
              }

              updateSql += ' WHERE id = ?';
              params.push(existing.id);

              db.prepare(updateSql).run(...params);
              this.updateCampaignStats(existing.campaign_id);
              processedCount++;
            }
          }

          // 2. Mensagens Recebidas (Opt-Out / Lista Negra Isolada da Empresa)
          const inboundMessages = value?.messages || [];
          for (const msgObj of inboundMessages) {
            const fromPhone = msgObj.from;
            const textBody = (msgObj.text?.body || '').trim().toLowerCase();

            const optOutKeywords = ['sair', 'parar', 'cancelar', 'stop', 'descadastrar', 'remover', 'nao quero', 'não quero'];
            const isOptOut = optOutKeywords.some(kw => textBody.includes(kw));

            if (isOptOut && fromPhone) {
              console.log(`🛡️ Opt-Out detectado para empresa #${tenantId}! Adicionando ${fromPhone} à Lista Negra...`);
              addToBlacklist(fromPhone, '', `Opt-out automático via resposta: "${msgObj.text?.body}"`, 'WEBHOOK_OPTOUT', tenantId);

              // Resposta automática de confirmação enviada com a credencial da empresa
              this.sendDirectTextMessage(fromPhone, 'Você foi removido da nossa lista com sucesso e não receberá mais mensagens.', tenantId).catch(() => {});
              processedCount++;
            }
          }
        }
      }
    }

    return { processed: processedCount };
  }

  /**
   * Recalcula estatísticas agregadas da campanha
   */
  updateCampaignStats(campaignId) {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('SENT', 'DELIVERED', 'READ') THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status IN ('DELIVERED', 'READ') THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status = 'READ' THEN 1 ELSE 0 END) as read,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
      FROM campaign_messages
      WHERE campaign_id = ?
    `).get(campaignId);

    db.prepare(`
      UPDATE campaigns 
      SET 
        sent_count = ?,
        delivered_count = ?,
        read_count = ?,
        failed_count = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      stats.sent || 0,
      stats.delivered || 0,
      stats.read || 0,
      stats.failed || 0,
      campaignId
    );
  }

  /**
   * Envia uma mensagem de texto simples diretamente
   */
  async sendDirectTextMessage(to, textBody, tenantId = 1) {
    const creds = this.getCredentials({}, tenantId);

    if (creds.simulationMode) {
      return { success: true, isSimulated: true };
    }

    if (!creds.accessToken || !creds.phoneNumberId) return { success: false };

    const url = `https://graph.facebook.com/${creds.apiVersion}/${creds.phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(to),
      type: 'text',
      text: { body: textBody }
    };

    try {
      const res = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      return { success: true, messageId: res.data?.messages?.[0]?.id };
    } catch (err) {
      console.warn('Erro no envio de mensagem direta:', err.response?.data || err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Cria e submete um novo template oficial para aprovação da Meta
   */
  async createTemplate({ name, category = 'UTILITY', language = 'pt_BR', components = [] }, tenantId = 1) {
    const creds = this.getCredentials({}, tenantId);

    if (creds.simulationMode || !creds.wabaId || !creds.accessToken) {
      const stmt = db.prepare(`
        INSERT INTO templates_cache (tenant_id, name, language, category, status, components, updated_at)
        VALUES (?, ?, ?, ?, 'APPROVED', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(name, language) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          category = excluded.category,
          status = 'APPROVED',
          components = excluded.components,
          updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(tenantId, name, language, category, JSON.stringify(components));
      return { success: true, id: `mock_tpl_${Date.now()}`, isSimulated: true };
    }

    const url = `https://graph.facebook.com/${creds.apiVersion}/${creds.wabaId}/message_templates`;

    try {
      const res = await axios.post(url, {
        name,
        category,
        language,
        components
      }, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const stmt = db.prepare(`
        INSERT INTO templates_cache (tenant_id, meta_id, name, language, category, status, components, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(name, language) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          meta_id = excluded.meta_id,
          category = excluded.category,
          status = excluded.status,
          components = excluded.components,
          updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(tenantId, res.data.id, name, language, category, res.data.status || 'PENDING', JSON.stringify(components));

      return { success: true, id: res.data.id, status: res.data.status, isSimulated: false };
    } catch (error) {
      const metaError = error.response?.data?.error;
      const message = metaError 
        ? `[${metaError.code}] ${metaError.message}`
        : error.message;
      throw new Error(message);
    }
  }

  /**
   * Exclui um template da conta WABA
   */
  async deleteTemplate(name, tenantId = 1) {
    const creds = this.getCredentials({}, tenantId);

    if (creds.simulationMode || !creds.wabaId || !creds.accessToken) {
      db.prepare('DELETE FROM templates_cache WHERE tenant_id = ? AND name = ?').run(tenantId, name);
      return { success: true, isSimulated: true };
    }

    const url = `https://graph.facebook.com/${creds.apiVersion}/${creds.wabaId}/message_templates?name=${encodeURIComponent(name)}`;

    try {
      await axios.delete(url, {
        headers: { Authorization: `Bearer ${creds.accessToken}` }
      });
      db.prepare('DELETE FROM templates_cache WHERE tenant_id = ? AND name = ?').run(tenantId, name);
      return { success: true, isSimulated: false };
    } catch (error) {
      const metaError = error.response?.data?.error;
      const message = metaError 
        ? `[${metaError.code}] ${metaError.message}`
        : error.message;
      throw new Error(message);
    }
  }
}

module.exports = new MetaService();
