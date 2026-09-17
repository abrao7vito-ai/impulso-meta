const { db, isPhoneBlacklisted, checkTenantQuota, incrementTenantSent } = require('../db/database');
const metaService = require('./metaService');
const { sanitizePhoneNumber } = require('../utils/phone');

class CampaignEngine {
  constructor() {
    this.activeCampaigns = new Map(); // campaignId -> { isRunning, isPaused, shouldStop }
    this.schedulerInterval = null;
    this.startScheduler();
    this.recoverInterruptedCampaigns();
  }

  /**
   * Auto-recuperação pós-reinício ou queda do servidor
   */
  recoverInterruptedCampaigns() {
    try {
      // Reverte mensagens que ficaram em SENDING sem wamid
      db.prepare("UPDATE campaign_messages SET status = 'PENDING' WHERE status = 'SENDING' AND wamid IS NULL").run();

      // Identifica campanhas que estavam em execução no momento do encerramento
      const interrupted = db.prepare("SELECT id, name FROM campaigns WHERE status = 'RUNNING'").all();
      for (const camp of interrupted) {
        console.log(`🔄 Retomando automaticamente campanha #${camp.id} (${camp.name})...`);
        this.startCampaign(camp.id).catch(err => {
          console.error(`Erro ao retomar campanha #${camp.id}:`, err);
        });
      }
    } catch (err) {
      console.warn('Aviso: Erro na auto-recuperação de campanhas:', err.message);
    }
  }

  /**
   * Inicia o verificador contínuo de campanhas agendadas
   */
  startScheduler() {
    if (this.schedulerInterval) return;
    this.schedulerInterval = setInterval(() => {
      this.checkScheduledCampaigns();
    }, 15000); // checa a cada 15 segundos
  }

  /**
   * Verifica se há campanhas agendadas cujo horário já foi atingido
   */
  checkScheduledCampaigns() {
    try {
      const now = new Date().toISOString();
      const scheduled = db.prepare(
        "SELECT id, name FROM campaigns WHERE status = 'SCHEDULED' AND scheduled_at <= ?"
      ).all(now);

      for (const camp of scheduled) {
        console.log(`⏰ Disparando campanha agendada #${camp.id} (${camp.name})...`);
        this.startCampaign(camp.id).catch(err => {
          console.error(`Erro ao disparar campanha agendada #${camp.id}:`, err);
        });
      }
    } catch (err) {
      console.error('Erro no scheduler de campanhas:', err);
    }
  }

  /**
   * Agenda uma campanha para data/hora futura
   */
  scheduleCampaign(campaignId, scheduledAt) {
    db.prepare("UPDATE campaigns SET status = 'SCHEDULED', scheduled_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(new Date(scheduledAt).toISOString(), campaignId);
    return { success: true, message: `Campanha agendada para ${new Date(scheduledAt).toLocaleString('pt-BR')}` };
  }

  /**
   * Inicia o disparo de uma campanha
   */
  async startCampaign(campaignId) {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) {
      throw new Error(`Campanha #${campaignId} não encontrada.`);
    }

    if (campaign.status === 'RUNNING') {
      return { message: 'Campanha já está em execução.' };
    }

    // Valida cota do tenant antes de iniciar
    const tenantId = campaign.tenant_id || 1;
    const quota = checkTenantQuota(tenantId);
    if (!quota.canSend) {
      db.prepare("UPDATE campaigns SET status = 'PAUSED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(campaignId);
      throw new Error(`Limite do plano atingido: ${quota.reason}`);
    }

    // Marca como RUNNING
    db.prepare("UPDATE campaigns SET status = 'RUNNING', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(campaignId);

    const controller = {
      isRunning: true,
      isPaused: false,
      shouldStop: false
    };
    this.activeCampaigns.set(campaignId, controller);

    // Executa em segundo plano sem bloquear a resposta HTTP
    this.processCampaignQueue(campaignId, controller).catch(err => {
      console.error(`Erro na execução da campanha #${campaignId}:`, err);
    });

    return { success: true, message: 'Disparo iniciado com sucesso.' };
  }

  /**
   * Pausa uma campanha em andamento
   */
  pauseCampaign(campaignId) {
    const controller = this.activeCampaigns.get(campaignId);
    if (controller) {
      controller.isPaused = true;
      db.prepare("UPDATE campaigns SET status = 'PAUSED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(campaignId);
      return { success: true, message: 'Campanha pausada.' };
    }
    return { success: false, message: 'Campanha não está em execução.' };
  }

  /**
   * Retoma uma campanha pausada
   */
  resumeCampaign(campaignId) {
    let controller = this.activeCampaigns.get(campaignId);
    if (controller) {
      controller.isPaused = false;
      db.prepare("UPDATE campaigns SET status = 'RUNNING', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(campaignId);
      return { success: true, message: 'Campanha retomada.' };
    } else {
      return this.startCampaign(campaignId);
    }
  }

  /**
   * Cancela / Interrompe uma campanha
   */
  cancelCampaign(campaignId) {
    const controller = this.activeCampaigns.get(campaignId);
    if (controller) {
      controller.shouldStop = true;
    }
    this.activeCampaigns.delete(campaignId);
    db.prepare("UPDATE campaigns SET status = 'CANCELED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(campaignId);
    return { success: true, message: 'Campanha cancelada.' };
  }

  /**
   * Loop de processamento de cada mensagem da fila
   */
  async processCampaignQueue(campaignId, controller) {
    try {
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
      if (!campaign) return;

      const tenantId = campaign.tenant_id || 1;
      const mapping = JSON.parse(campaign.parameters_mapping || '{}');
      const delayMs = Math.max(200, campaign.delay_ms || 1000);

      // Pega todas as mensagens pendentes
      const messages = db.prepare(
        "SELECT * FROM campaign_messages WHERE campaign_id = ? AND status = 'PENDING' ORDER BY id ASC"
      ).all(campaignId);

      for (const msg of messages) {
        if (controller.shouldStop) break;

        while (controller.isPaused) {
          if (controller.shouldStop) break;
          await new Promise(r => setTimeout(r, 1000));
        }

        if (controller.shouldStop) break;

        // Valida cota mensal antes de cada envio
        const quota = checkTenantQuota(tenantId);
        if (!quota.canSend) {
          db.prepare("UPDATE campaigns SET status = 'PAUSED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(campaignId);
          console.warn(`Campanha #${campaignId} pausada: cota mensal esgotada para empresa #${tenantId}`);
          break;
        }

        // Sanitiza telefone
        const phoneCheck = sanitizePhoneNumber(msg.phone);
        if (!phoneCheck.isValid) {
          db.prepare(`
            UPDATE campaign_messages 
            SET status = 'FAILED', error_message = ?, error_code = 'INVALID_PHONE'
            WHERE id = ?
          `).run(phoneCheck.reason || 'Telefone inválido', msg.id);

          metaService.updateCampaignStats(campaignId);
          continue;
        }

        // CHECAGEM DE ANTI-BAN: Se o contato está na Lista Negra da Empresa, PULA O ENVIO!
        if (isPhoneBlacklisted(phoneCheck.formatted, tenantId)) {
          db.prepare(`
            UPDATE campaign_messages 
            SET status = 'SKIPPED_OPT_OUT', error_message = 'Contato na Lista Negra (Opt-Out)', error_code = 'OPT_OUT'
            WHERE id = ?
          `).run(msg.id);

          metaService.updateCampaignStats(campaignId);
          continue;
        }

        // Atualiza para SENDING
        db.prepare("UPDATE campaign_messages SET status = 'SENDING' WHERE id = ?").run(msg.id);

        // Prepara dados e parâmetros do template
        const customData = JSON.parse(msg.custom_data || '{}');
        const bodyParams = [];

        const paramKeys = Object.keys(mapping).sort((a, b) => parseInt(a) - parseInt(b));
        for (const key of paramKeys) {
          const fieldName = mapping[key];
          const value = customData[fieldName] !== undefined ? customData[fieldName] : (customData[fieldName.toLowerCase()] || '');
          bodyParams.push(value);
        }

        // Executa disparo usando as credenciais da empresa (tenant)
        const result = await metaService.sendTemplateMessage({
          to: phoneCheck.formatted,
          templateName: campaign.template_name,
          languageCode: campaign.template_language || 'pt_BR',
          bodyParameters: bodyParams
        }, tenantId);

        const nowIso = new Date().toISOString();

        if (result.success) {
          db.prepare(`
            UPDATE campaign_messages 
            SET status = 'SENT', wamid = ?, sent_at = ?
            WHERE id = ?
          `).run(result.messageId, nowIso, msg.id);

          // Registra no consumo mensal da empresa
          incrementTenantSent(tenantId, 1);

          if (result.isSimulated) {
            this.simulateDeliveryAndRead(msg.id, campaignId);
          }
        } else {
          db.prepare(`
            UPDATE campaign_messages 
            SET status = 'FAILED', error_message = ?, error_code = ?
            WHERE id = ?
          `).run(result.error || 'Erro no envio', result.errorCode || 'UNKNOWN', msg.id);
        }

        metaService.updateCampaignStats(campaignId);
        await new Promise(r => setTimeout(r, delayMs));
      }

      // Finaliza a campanha se processou tudo e não foi cancelada
      if (!controller.shouldStop) {
        const remaining = db.prepare(
          "SELECT COUNT(*) as count FROM campaign_messages WHERE campaign_id = ? AND status IN ('PENDING', 'SENDING')"
        ).get(campaignId);

        if (remaining.count === 0) {
          db.prepare("UPDATE campaigns SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(campaignId);
        }
      }
    } catch (err) {
      console.error(`Falha no processamento da campanha #${campaignId}:`, err);
    } finally {
      this.activeCampaigns.delete(campaignId);
    }
  }

  /**
   * Simula entregas e leituras em segundo plano quando em modo Sandbox/Simulação
   */
  simulateDeliveryAndRead(messageId, campaignId) {
    setTimeout(() => {
      try {
        db.prepare("UPDATE campaign_messages SET status = 'DELIVERED', delivered_at = ? WHERE id = ? AND status = 'SENT'")
          .run(new Date().toISOString(), messageId);
        metaService.updateCampaignStats(campaignId);

        if (Math.random() < 0.75) {
          setTimeout(() => {
            try {
              db.prepare("UPDATE campaign_messages SET status = 'READ', read_at = ? WHERE id = ? AND status = 'DELIVERED'")
                .run(new Date().toISOString(), messageId);
              metaService.updateCampaignStats(campaignId);
            } catch (_) {}
          }, Math.random() * 3000 + 2000);
        }
      } catch (_) {}
    }, Math.random() * 2000 + 1000);
  }
}

module.exports = new CampaignEngine();
