const axios = require('axios');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('--- INICIANDO TESTES DO SISTEMA DE DISPARO META (COMPLETO) ---');

  // 1. Inicia o servidor local para testes
  require('../src/server.js');
  await new Promise(r => setTimeout(r, 1000));

  let passed = 0;
  let failed = 0;

  async function assertTest(name, fn) {
    try {
      await fn();
      console.log(`✅ [PASSOU] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FALHOU] ${name}:`, err.response?.data || err.message);
      failed++;
    }
  }

  // Preserva configurações originais e ativa simulação durante os testes unitários
  const initialSettingsRes = await axios.get(`${BASE_URL}/api/settings`);
  const originalSettings = { ...initialSettingsRes.data };
  await axios.post(`${BASE_URL}/api/settings`, {
    ...originalSettings,
    simulation_mode: true
  });

  try {
    // Teste 1: Testar Settings API
    await assertTest('Obter configurações da API', async () => {
      const res = await axios.get(`${BASE_URL}/api/settings`);
      if (!res.data.meta_verify_token) throw new Error('meta_verify_token não encontrado');
    });

    // Teste 2: Testar Conexão em Modo Simulação
    await assertTest('Testar conexão (Sandbox/Simulação)', async () => {
      const res = await axios.post(`${BASE_URL}/api/settings/test-connection`, {
        simulationMode: true
      });
      if (!res.data.success || !res.data.simulation) throw new Error('Falha no teste de conexão simulada');
    });

    // Teste 3: Sincronizar Templates
    await assertTest('Sincronizar Templates da Meta', async () => {
      const res = await axios.post(`${BASE_URL}/api/templates/sync`);
      if (res.data.count < 1) throw new Error('Nenhum template retornado');
      const listRes = await axios.get(`${BASE_URL}/api/templates`);
      if (listRes.data.length === 0) throw new Error('Templates em cache vazios');
    });

    // Teste 4: Importar e Pré-visualizar Contatos (CSV Texto)
    let importData;
    await assertTest('Importar e pré-visualizar contatos CSV', async () => {
      const sampleCsv = fs.readFileSync(path.join(__dirname, '../samples/lista_exemplo_clientes.csv'), 'utf8');
      const res = await axios.post(`${BASE_URL}/api/campaigns/import-preview`, {
        textData: sampleCsv
      });
      if (res.data.validCount !== 5) throw new Error(`Esperado 5 contatos válidos, obteve ${res.data.validCount}`);
      if (!res.data.headers.includes('Telefone')) throw new Error('Header Telefone não detectado');
      importData = res.data;
    });

    // Teste 5: Criar Nova Campanha Imediata
    let createdCampaignId;
    await assertTest('Criar nova campanha de disparo imediato', async () => {
      const res = await axios.post(`${BASE_URL}/api/campaigns`, {
        name: 'Campanha de Teste Automatizado',
        templateName: 'confirmacao_pedido',
        templateLanguage: 'pt_BR',
        delayMs: 200,
        parametersMapping: {
          "1": "Nome",
          "2": "Codigo",
          "3": "Valor"
        },
        contacts: importData.validContacts
      });
      if (!res.data.campaignId) throw new Error('ID da campanha não retornado');
      createdCampaignId = res.data.campaignId;
    });

    // Teste 6: Iniciar Disparo da Campanha
    await assertTest('Iniciar execução da campanha', async () => {
      const res = await axios.post(`${BASE_URL}/api/campaigns/${createdCampaignId}/start`);
      if (!res.data.success) throw new Error('Disparo não retornou sucesso');

      // Aguarda o processamento de 5 mensagens
      await new Promise(r => setTimeout(r, 2000));

      const check = await axios.get(`${BASE_URL}/api/campaigns/${createdCampaignId}`);
      if (check.data.campaign.sent_count < 5) {
        throw new Error(`Esperado pelo menos 5 mensagens enviadas, obteve ${check.data.campaign.sent_count}`);
      }
    });

    // Teste 7: Testar Webhook Verification (GET)
    await assertTest('Webhook Verificação (hub.mode=subscribe)', async () => {
      const settings = (await axios.get(`${BASE_URL}/api/settings`)).data;
      const challenge = 'random_challenge_string_xyz';
      const res = await axios.get(`${BASE_URL}/api/webhook?hub.mode=subscribe&hub.verify_token=${settings.meta_verify_token}&hub.challenge=${challenge}`);
      if (res.data !== challenge) throw new Error('Webhook challenge incorreto');
    });

    // Teste 8: Testar Webhook Reception (POST de status DELIVERED/READ)
    await assertTest('Webhook Recebimento de Status (POST)', async () => {
      const campaignDetails = (await axios.get(`${BASE_URL}/api/campaigns/${createdCampaignId}`)).data;
      const firstMsg = campaignDetails.messages[0];

      const fakeWebhookBody = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '5511999990000', phone_number_id: '12345' },
                  statuses: [
                    {
                      id: firstMsg.wamid,
                      status: 'read',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      recipient_id: firstMsg.phone
                    }
                  ]
                },
                field: 'messages'
              }
            ]
          }
        ]
      };

      const webhookRes = await axios.post(`${BASE_URL}/api/webhook`, fakeWebhookBody);
      if (webhookRes.data.status !== 'success') throw new Error('Webhook post falhou');

      const updatedCheck = await axios.get(`${BASE_URL}/api/campaigns/${createdCampaignId}`);
      const updatedMsg = updatedCheck.data.messages.find(m => m.id === firstMsg.id);
      if (updatedMsg.status !== 'READ') {
        throw new Error(`Mensagem deveria estar READ, status atual: ${updatedMsg.status}`);
      }
    });

    // Teste 9: Feature 1 - Criador & Submissor de Templates
    await assertTest('Template Builder (Criar, Salvar e Excluir)', async () => {
      const tplName = 'teste_auto_tpl_' + Date.now().toString().slice(-5);
      const createRes = await axios.post(`${BASE_URL}/api/templates`, {
        name: tplName,
        category: 'UTILITY',
        language: 'pt_BR',
        headerText: 'AVISO DE TESTE',
        bodyText: 'Olá {{1}}, este é um teste automático de template.',
        footerText: 'Responda SAIR para cancelar'
      });
      if (!createRes.data.success) throw new Error('Falha ao criar template');

      // Exclui o template de teste
      const delRes = await axios.delete(`${BASE_URL}/api/templates/${tplName}`);
      if (!delRes.data.success) throw new Error('Falha ao excluir template');
    });

    // Teste 10: Feature 2 - Agendador de Campanhas (Scheduler Worker)
    await assertTest('Agendamento de Campanhas & Auto-Disparo do Worker', async () => {
      // Cria campanha agendada para 2 segundos no futuro
      const futureDate = new Date(Date.now() + 2000).toISOString();
      const schedRes = await axios.post(`${BASE_URL}/api/campaigns`, {
        name: 'Campanha Agendada Teste',
        templateName: 'confirmacao_pedido',
        templateLanguage: 'pt_BR',
        delayMs: 100,
        contacts: [
          { phone: '5511999990001', name: 'Agendado 1' },
          { phone: '5511999990002', name: 'Agendado 2' }
        ],
        scheduledAt: futureDate
      });

      const schedCampaignId = schedRes.data.campaignId;
      await axios.post(`${BASE_URL}/api/campaigns/${schedCampaignId}/schedule`, {
        scheduledAt: futureDate
      });

      // Confirma status SCHEDULED
      let checkSched = await axios.get(`${BASE_URL}/api/campaigns/${schedCampaignId}`);
      if (checkSched.data.campaign.status !== 'SCHEDULED') {
        throw new Error(`Status esperado SCHEDULED, obteve ${checkSched.data.campaign.status}`);
      }

      // Força a checagem do scheduler engine imediatamente
      const campaignEngine = require('../src/services/campaignEngine');
      await new Promise(r => setTimeout(r, 2200));
      await campaignEngine.checkScheduledCampaigns();

      // Aguarda o disparo
      await new Promise(r => setTimeout(r, 1500));
      checkSched = await axios.get(`${BASE_URL}/api/campaigns/${schedCampaignId}`);
      if (checkSched.data.campaign.status !== 'COMPLETED' && checkSched.data.campaign.status !== 'RUNNING') {
        throw new Error(`Status da campanha agendada deveria ser RUNNING ou COMPLETED, obteve ${checkSched.data.campaign.status}`);
      }
    });

    // Teste 11: Feature 3 - Opt-Out Automático via Webhook e Lista Negra
    await assertTest('Opt-Out Anti-Ban Automático via Mensagem Recebida', async () => {
      const optOutPhone = '5511999887766';

      // Simula recebimento de mensagem WhatsApp com palavra-chave "SAIR"
      const optOutWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '5511999990000', phone_number_id: '12345' },
                  messages: [
                    {
                      from: optOutPhone,
                      id: 'wamid.INBOUND_TEST_' + Date.now(),
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      text: { body: 'Por favor, quero SAIR da lista' },
                      type: 'text'
                    }
                  ]
                },
                field: 'messages'
              }
            ]
          }
        ]
      };

      await axios.post(`${BASE_URL}/api/webhook`, optOutWebhookPayload);

      // Verifica se o número foi inserido na Blacklist
      const blRes = await axios.get(`${BASE_URL}/api/blacklist`);
      const found = blRes.data.find(b => b.phone === optOutPhone);
      if (!found) throw new Error(`Telefone ${optOutPhone} não foi adicionado automaticamente à blacklist`);
      if (found.source !== 'WEBHOOK_OPTOUT') throw new Error(`Origem esperada WEBHOOK_OPTOUT, obteve ${found.source}`);

      // Testa remoção/desbloqueio
      await axios.delete(`${BASE_URL}/api/blacklist/${optOutPhone}`);
    });

    // Teste 12: Feature 4 - Gestão de Listas Salvas (Audiências)
    await assertTest('Gestão de Audiências / Listas Salvas (CRUD)', async () => {
      // 1. Criar lista salva
      const createRes = await axios.post(`${BASE_URL}/api/lists`, {
        name: 'Lista VIP de Teste',
        description: 'Clientes de alta conversão',
        contacts: [
          { phone: '5511999991111', name: 'Cliente A', customData: { Cidade: 'SP', Saldo: '500' } },
          { phone: '5511999992222', name: 'Cliente B', customData: { Cidade: 'RJ', Saldo: '750' } }
        ]
      });
      if (!createRes.data.listId) throw new Error('ID da lista salva não retornado');
      const listId = createRes.data.listId;

      // 2. Consultar lista salva e seus itens
      const getRes = await axios.get(`${BASE_URL}/api/lists/${listId}`);
      if (getRes.data.items.length !== 2) throw new Error(`Esperado 2 contatos na lista, obteve ${getRes.data.items.length}`);

      // 3. Excluir lista salva
      const delRes = await axios.delete(`${BASE_URL}/api/lists/${listId}`);
      if (!delRes.data.success) throw new Error('Falha ao excluir lista');
    });

    // Teste 13: Testar Métricas do Dashboard
    await assertTest('Verificar Métricas Agregadas do Dashboard', async () => {
      const res = await axios.get(`${BASE_URL}/api/dashboard/stats`);
      if (res.data.totalCampaigns < 1) throw new Error('totalCampaigns deveria ser >= 1');
      if (res.data.totalSent < 5) throw new Error('totalSent deveria ser >= 5');
    });

    // Teste 14: Testar Exportação em Excel (.xlsx)
    await assertTest('Exportar Relatório em Excel (.xlsx)', async () => {
      const res = await axios.get(`${BASE_URL}/api/campaigns/${createdCampaignId}/export`, {
        responseType: 'arraybuffer'
      });
      if (res.data.length < 100) throw new Error('Buffer de exportação do Excel vazio ou inválido');
    });

    // Teste 15: SaaS - Autenticação JWT e Login
    let adminToken, clientToken;
    await assertTest('SaaS Autenticação JWT & Login', async () => {
      // Login inválido
      try {
        await axios.post(`${BASE_URL}/api/auth/login`, { email: 'admin@disparozap.com', password: 'wrong' });
        throw new Error('Deveria ter rejeitado senha incorreta');
      } catch (e) {
        if (e.response?.status !== 401) throw e;
      }

      // Login Super Admin
      const adminLogin = await axios.post(`${BASE_URL}/api/auth/login`, {
        email: 'admin@disparozap.com',
        password: 'admin123'
      });
      if (!adminLogin.data.token || adminLogin.data.user.role !== 'SUPERADMIN') {
        throw new Error('Falha no login do SuperAdmin');
      }
      adminToken = adminLogin.data.token;

      // Login Cliente Tenant 1
      const clientLogin = await axios.post(`${BASE_URL}/api/auth/login`, {
        email: 'cliente@empresa.com',
        password: 'cliente123'
      });
      if (!clientLogin.data.token || clientLogin.data.user.tenantId !== 1) {
        throw new Error('Falha no login do Cliente Tenant');
      }
      clientToken = clientLogin.data.token;

      // Perfil /me com cota
      const meRes = await axios.get(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${clientToken}` }
      });
      if (!meRes.data.quota || meRes.data.quota.monthlyLimit < 1000) {
        throw new Error('Cota do plano não retornada no perfil');
      }
    });

    // Teste 16: SaaS - Painel Super Admin (Overview, Tenants e Planos)
    let newTenantId;
    await assertTest('SaaS Painel Super Admin (CRUD Empresas & Planos)', async () => {
      const overview = await axios.get(`${BASE_URL}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      if (!overview.data.metrics || overview.data.metrics.totalTenants < 1) {
        throw new Error('Métricas globais do admin inválidas');
      }

      // Cria nova empresa cliente
      const newTenantRes = await axios.post(`${BASE_URL}/api/admin/tenants`, {
        name: 'Cliente SaaS Teste Ltda',
        document: '12.345.678/0001-90',
        planId: 1,
        adminName: 'Gestor Teste',
        adminEmail: `teste_${Date.now()}@cliente.com`,
        adminPassword: 'senha_segura_123'
      }, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      if (!newTenantRes.data.tenantId) throw new Error('Tenant não criado pelo admin');
      newTenantId = newTenantRes.data.tenantId;
    });

    // Teste 17: SaaS - Ação de Suspensão com 1 Clique & Bloqueio
    await assertTest('SaaS Ação Rápida de Suspensão & Desbloqueio', async () => {
      // Suspende tenant
      await axios.post(`${BASE_URL}/api/admin/tenants/${newTenantId}/status`, {
        status: 'SUSPENDED'
      }, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      const tenantDetails = await axios.get(`${BASE_URL}/api/admin/tenants/${newTenantId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      if (tenantDetails.data.tenant.status !== 'SUSPENDED') {
        throw new Error('Empresa deveria estar SUSPENDED');
      }

      // Reativa tenant
      await axios.post(`${BASE_URL}/api/admin/tenants/${newTenantId}/status`, {
        status: 'ACTIVE'
      }, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
    });

    // Teste 18: SaaS - Criptografia de Tokens Meta (AES-256-GCM)
    await assertTest('SaaS Criptografia AES-256-GCM de Tokens Meta', async () => {
      const { encryptToken, decryptToken } = require('../src/utils/crypto');
      const testSecretToken = 'EAA_SUPER_SECRET_PERMANENT_META_TOKEN_999';
      const enc = encryptToken(testSecretToken);

      if (!enc.encrypted || !enc.iv || !enc.tag) throw new Error('Criptografia AES-256 falhou');
      if (enc.encrypted === testSecretToken) throw new Error('Token não foi cifrado');

      const decrypted = decryptToken(enc.encrypted, enc.iv, enc.tag);
      if (decrypted !== testSecretToken) throw new Error('Descriptografia falhou');
    });

    // Teste 19: SaaS - Isolamento Multi-Tenant da Lista Negra
    await assertTest('SaaS Isolamento Multi-Tenant de Opt-Out / Blacklist', async () => {
      const { addToBlacklist, isPhoneBlacklisted, removeFromBlacklist } = require('../src/db/database');
      const testPhone = '5511999998888';

      // Bloqueia no Tenant 1
      addToBlacklist(testPhone, 'OptOut A', 'Descadastro', 'MANUAL', 1);

      // Deve estar bloqueado no Tenant 1, mas LIVRE no Tenant criado (newTenantId)
      const isBlockedInTenant1 = isPhoneBlacklisted(testPhone, 1);
      const isBlockedInTenantNew = isPhoneBlacklisted(testPhone, newTenantId);

      if (!isBlockedInTenant1) throw new Error('Deveria estar bloqueado no Tenant 1');
      if (isBlockedInTenantNew) throw new Error('NÃO deveria estar bloqueado no novo Tenant');

      removeFromBlacklist(testPhone, 1);
    });

  } finally {
    // Restaura as configurações originais salvas no SQLite
    await axios.post(`${BASE_URL}/api/settings`, originalSettings);
  }

  console.log('\n==========================================');
  console.log(`TOTAL TESTES: ${passed + failed} | PASSOU: ${passed} | FALHOU: ${failed}`);
  console.log('==========================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Erro geral no runner de testes:', err);
  process.exit(1);
});
