// Interceptador global para anexar token de autenticação quando logado
const originalFetch = window.fetch;
window.fetch = async function (url, options = {}) {
  const token = localStorage.getItem('auth_token');
  if (token) {
    options.headers = options.headers || {};
    if (options.headers instanceof Headers) {
      if (!options.headers.has('Authorization')) {
        options.headers.set('Authorization', `Bearer ${token}`);
      }
    } else if (Array.isArray(options.headers)) {
      if (!options.headers.some(([k]) => k.toLowerCase() === 'authorization')) {
        options.headers.push(['Authorization', `Bearer ${token}`]);
      }
    } else {
      if (!options.headers['Authorization'] && !options.headers['authorization']) {
        options.headers['Authorization'] = `Bearer ${token}`;
      }
    }
  }
  return originalFetch(url, options);
};

// Estado da Aplicação
const state = {
  currentTab: 'dashboard',
  currentStep: 1,
  templates: [],
  selectedTemplate: null,
  parsedContacts: null,
  selectedPhoneCol: '',
  selectedNameCol: '',
  variableMapping: {},
  settings: {},
  audiences: [],
  blacklist: [],
  contactSourceMode: 'upload',
  activeModalCampaignId: null,
  pollingInterval: null
};

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) lucide.createIcons();
  initUserProfile();
  await loadSettings();
  await loadDashboardStats();
  await loadTemplates();
  await loadAllCampaigns();

  // Inicia polling suave para atualização de métricas e campanhas ativas
  state.pollingInterval = setInterval(() => {
    if (state.currentTab === 'dashboard') {
      loadDashboardStats(true);
    } else if (state.currentTab === 'campaigns') {
      loadAllCampaigns(true);
    }
    if (state.activeModalCampaignId) {
      loadModalMessages(true);
    }
  }, 4000);
});

// Inicializa perfil do usuário logado e cota da assinatura
async function initUserProfile() {
  const userJson = localStorage.getItem('auth_user');
  if (userJson) {
    try {
      const user = JSON.parse(userJson);
      const nameEl = document.getElementById('user-display-name');
      const tenantEl = document.getElementById('user-tenant-name');
      const initialsEl = document.getElementById('user-avatar-initials');
      const adminLink = document.getElementById('header-admin-link');

      if (nameEl) nameEl.textContent = user.name || 'Ana Souza';
      if (tenantEl) tenantEl.textContent = user.tenantName || 'Sua empresa';
      if (initialsEl && user.name) {
        const parts = user.name.trim().split(' ');
        const initials = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
        initialsEl.textContent = initials;
      }
      if (adminLink && user.role === 'SUPERADMIN') {
        adminLink.classList.remove('hidden');
        adminLink.classList.add('inline-flex');
      }

      // Busca dados de cota e plano atualizados da empresa
      try {
        const meRes = await fetch('/api/auth/me');
        if (meRes.ok) {
          const meData = await meRes.json();
          if (meData.tenant && meData.quota) {
            const quotaPill = document.getElementById('tenant-quota-pill');
            const planBadge = document.getElementById('tenant-plan-badge');
            const quotaText = document.getElementById('tenant-quota-text');
            if (quotaPill && planBadge && quotaText) {
              planBadge.textContent = meData.tenant.plan_name || 'Assinante';
              quotaText.textContent = `${(meData.quota.sentThisMonth || 0).toLocaleString('pt-BR')} / ${(meData.quota.monthlyLimit || 0).toLocaleString('pt-BR')} msgs`;
              quotaPill.classList.remove('hidden');
              quotaPill.classList.add('flex');
            }
          }
        }
      } catch (e) {}
    } catch (e) {}
  }
}

function handleLogout() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
  window.location.href = '/login.html';
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar-drawer');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar) return;
  sidebar.classList.toggle('-translate-x-full');
  if (overlay) overlay.classList.toggle('hidden');
}

// Navegação de Abas
function switchTab(tabName) {
  state.currentTab = tabName;
  document.querySelectorAll('.tab-view').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.remove('bg-emerald-100/70', 'text-emerald-800', 'font-semibold', 'border-emerald-600', 'text-emerald-700');
    btn.classList.add('text-slate-600', 'hover:text-slate-900', 'hover:bg-slate-100/70');
  });

  const activeView = document.getElementById(`view-${tabName}`);
  if (activeView) activeView.classList.remove('hidden');

  const activeBtn = document.getElementById(`tab-btn-${tabName}`);
  if (activeBtn) {
    activeBtn.classList.remove('text-slate-600', 'hover:text-slate-900', 'hover:bg-slate-100/70');
    activeBtn.classList.add('bg-emerald-100/70', 'text-emerald-800', 'font-semibold');
  }

  // Fecha sidebar no mobile ao clicar em um link
  const sidebar = document.getElementById('sidebar-drawer');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && overlay && !sidebar.classList.contains('-translate-x-full') && window.innerWidth < 1024) {
    sidebar.classList.add('-translate-x-full');
    overlay.classList.add('hidden');
  }

  if (tabName === 'dashboard') loadDashboardStats();
  if (tabName === 'campaigns') loadAllCampaigns();
  if (tabName === 'templates') renderTemplatesCatalog();
  if (tabName === 'audiences') loadAudiences();
  if (tabName === 'blacklist') loadBlacklist();
  if (tabName === 'new-campaign') {
    loadSavedAudiencesDropdown();
  }

  if (window.lucide) lucide.createIcons();
}

// Navegação do Wizard de Novo Disparo
function goToStep(step) {
  if (step === 2 && (!state.parsedContacts || state.parsedContacts.validContacts.length === 0)) {
    alert('Por favor, carregue uma lista válida de contatos antes de prosseguir.');
    return;
  }

  if (step === 3 && !state.selectedTemplate) {
    alert('Por favor, selecione um template do Meta.');
    return;
  }

  state.currentStep = step;
  document.querySelectorAll('.wizard-step').forEach(el => el.classList.add('hidden'));
  document.getElementById(`wizard-step-${step}`).classList.remove('hidden');

  // Atualiza indicadores do header do wizard
  for (let i = 1; i <= 4; i++) {
    const tabEl = document.getElementById(`step-tab-${i}`);
    const badge = tabEl.querySelector('span:first-child');
    if (i === step) {
      tabEl.className = 'flex items-center space-x-2 text-emerald-700 font-semibold text-sm';
      badge.className = 'w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs';
    } else if (i < step) {
      tabEl.className = 'flex items-center space-x-2 text-emerald-600 font-medium text-sm';
      badge.className = 'w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs';
    } else {
      tabEl.className = 'flex items-center space-x-2 text-slate-400 font-medium text-sm';
      badge.className = 'w-7 h-7 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs';
    }
  }

  if (step === 3) {
    renderVariableMapping();
  }

  if (step === 4) {
    renderReviewSummary();
  }

  if (window.lucide) lucide.createIcons();
}

// ----------------------------------------------------
// 1. CARREGAMENTO E IMPORTAÇÃO DE CONTATOS
// ----------------------------------------------------
async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/campaigns/import-preview', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    displayImportPreview(data);
  } catch (err) {
    alert('Erro ao processar arquivo: ' + err.message);
  }
}

async function loadSampleFile() {
  try {
    const res = await fetch('/samples/lista_exemplo_clientes.csv');
    const text = await res.text();

    const parseRes = await fetch('/api/campaigns/import-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textData: text })
    });
    const data = await parseRes.json();
    if (!parseRes.ok) throw new Error(data.error);

    displayImportPreview(data);
  } catch (err) {
    alert('Erro ao carregar exemplo: ' + err.message);
  }
}

async function parseRawTextContacts() {
  const text = document.getElementById('raw-contacts-textarea').value;
  if (!text.trim()) {
    alert('Cole o conteúdo da planilha ou lista no campo de texto.');
    return;
  }

  try {
    const res = await fetch('/api/campaigns/import-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textData: text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    displayImportPreview(data);
  } catch (err) {
    alert('Erro ao processar texto: ' + err.message);
  }
}

function displayImportPreview(data) {
  state.parsedContacts = data;

  const container = document.getElementById('import-preview-container');
  container.classList.remove('hidden');

  document.getElementById('preview-valid-count').textContent = data.validCount;
  const invalidBadge = document.getElementById('preview-invalid-badge');
  if (data.invalidCount > 0) {
    invalidBadge.classList.remove('hidden');
    document.getElementById('preview-invalid-count').textContent = data.invalidCount;
  } else {
    invalidBadge.classList.add('hidden');
  }

  // Preenche seletores de coluna
  const selectPhone = document.getElementById('select-phone-column');
  const selectName = document.getElementById('select-name-column');

  selectPhone.innerHTML = '';
  selectName.innerHTML = '<option value="">(Nenhum)</option>';

  data.headers.forEach(h => {
    const optP = document.createElement('option');
    optP.value = h;
    optP.textContent = h;
    if (h.toLowerCase() === data.detectedPhoneCol.toLowerCase()) optP.selected = true;
    selectPhone.appendChild(optP);

    const optN = document.createElement('option');
    optN.value = h;
    optN.textContent = h;
    if (h.toLowerCase() === data.detectedNameCol.toLowerCase()) optN.selected = true;
    selectName.appendChild(optN);
  });

  state.selectedPhoneCol = selectPhone.value;
  state.selectedNameCol = selectName.value;

  // Renderiza tabela com primeiras 5 linhas
  const thead = document.getElementById('preview-table-head');
  const tbody = document.getElementById('preview-table-body');

  thead.innerHTML = `<tr>${data.headers.map(h => `<th class="px-4 py-2 border-b border-slate-200">${h}</th>`).join('')}</tr>`;

  tbody.innerHTML = data.samplePreview.map(row => `
    <tr>
      ${data.headers.map(h => `<td class="px-4 py-2 border-b border-slate-100 text-slate-700">${row[h] !== undefined ? row[h] : ''}</td>`).join('')}
    </tr>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function recalculateContactColumns() {
  state.selectedPhoneCol = document.getElementById('select-phone-column').value;
  state.selectedNameCol = document.getElementById('select-name-column').value;
}

function setContactSourceMode(mode) {
  state.contactSourceMode = mode;
  const btnUpload = document.getElementById('btn-src-upload');
  const btnSaved = document.getElementById('btn-src-saved');
  const boxUpload = document.getElementById('source-mode-upload');
  const boxSaved = document.getElementById('source-mode-saved');

  if (!btnUpload || !btnSaved) return;

  if (mode === 'upload') {
    btnUpload.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-900 shadow-sm transition';
    btnSaved.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition';
    boxUpload.classList.remove('hidden');
    boxSaved.classList.add('hidden');
  } else {
    btnSaved.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-900 shadow-sm transition';
    btnUpload.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition';
    boxSaved.classList.remove('hidden');
    boxUpload.classList.add('hidden');
    loadSavedAudiencesDropdown();
  }
}

async function loadSavedAudiencesDropdown() {
  const select = document.getElementById('select-saved-audience');
  if (!select) return;

  try {
    const res = await fetch('/api/lists');
    const lists = await res.json();
    state.audiences = lists;

    if (lists.length === 0) {
      select.innerHTML = '<option value="">Nenhuma lista salva ainda. Carregue uma planilha ao lado.</option>';
      return;
    }

    select.innerHTML = '<option value="">-- Selecione uma lista salva --</option>' +
      lists.map(l => `<option value="${l.id}">${l.name} (${l.contact_count} contatos)</option>`).join('');
  } catch (err) {
    console.error('Erro ao carregar listas salvas:', err);
  }
}

function onSelectAudienceChange(listId) {
  // Chamado quando o usuário seleciona no dropdown
}

async function loadSelectedAudienceIntoWizard(explicitListId = null) {
  const listId = explicitListId || document.getElementById('select-saved-audience').value;
  if (!listId) {
    alert('Por favor, selecione uma lista salva no menu.');
    return;
  }

  try {
    const res = await fetch(`/api/lists/${listId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (!data.items || data.items.length === 0) {
      alert('Esta lista não possui contatos cadastrados.');
      return;
    }

    const validContacts = data.items.map(item => {
      let custom = {};
      try { custom = JSON.parse(item.custom_data || '{}'); } catch (e) {}
      return {
        name: item.name,
        phone: item.phone,
        rawPhone: item.phone,
        customData: {
          Nome: item.name,
          Telefone: item.phone,
          ...custom
        }
      };
    });

    const headers = Object.keys(validContacts[0].customData);
    const samplePreview = validContacts.slice(0, 5).map(c => c.customData);

    displayImportPreview({
      validCount: validContacts.length,
      invalidCount: 0,
      validContacts,
      invalidContacts: [],
      headers,
      detectedPhoneCol: 'Telefone',
      detectedNameCol: 'Nome',
      samplePreview
    });

    const nameInput = document.getElementById('campaign-name-input');
    if (nameInput) {
      nameInput.value = `Disparo - ${data.list.name} (${new Date().toLocaleDateString('pt-BR')})`;
    }
  } catch (err) {
    alert('Erro ao carregar lista salva: ' + err.message);
  }
}

function toggleSaveAudienceNameInput(checked) {
  const box = document.getElementById('save-as-audience-box');
  if (box) {
    if (checked) {
      box.classList.remove('hidden');
      const input = document.getElementById('save-audience-name-input');
      if (input && !input.value) {
        input.value = `Audiência ${new Date().toLocaleDateString('pt-BR')}`;
      }
    } else {
      box.classList.add('hidden');
    }
  }
}

// ----------------------------------------------------
// 2. TEMPLATES META & PRÉVIA DO WHATSAPP
// ----------------------------------------------------
async function loadTemplates() {
  try {
    const res = await fetch('/api/templates');
    const templates = await res.json();
    state.templates = templates;
    renderTemplatesCards();
    renderTemplatesCatalog();
    populateQuickTestTemplates();
  } catch (err) {
    console.error('Erro ao buscar templates:', err);
  }
}

async function syncTemplatesFromMeta() {
  try {
    const res = await fetch('/api/templates/sync', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    await loadTemplates();
    alert(`Sincronização concluída! ${data.count} templates carregados.`);
  } catch (err) {
    alert('Erro na sincronização: ' + err.message);
  }
}

function renderTemplatesCards() {
  const container = document.getElementById('templates-cards-container');
  if (!container) return;

  if (state.templates.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
        Nenhum template encontrado. Clique em "Sincronizar Templates da Meta" acima.
      </div>
    `;
    return;
  }

  container.innerHTML = state.templates.map(tpl => {
    const isSelected = state.selectedTemplate && state.selectedTemplate.name === tpl.name;
    const bodyComponent = tpl.components.find(c => c.type === 'BODY') || {};
    const bodyText = bodyComponent.text || '';

    // Categoria badge
    let catClass = 'bg-blue-50 text-blue-700 border-blue-200';
    if (tpl.category === 'MARKETING') catClass = 'bg-amber-50 text-amber-700 border-amber-200';

    return `
      <div onclick="selectTemplate('${tpl.name}')" class="p-4 rounded-xl border cursor-pointer transition ${isSelected ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/20' : 'border-slate-200 bg-white hover:border-slate-300'}">
        <div class="flex items-center justify-between mb-1.5">
          <div class="flex items-center space-x-2">
            <span class="font-bold text-sm text-slate-900">${tpl.name}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${catClass}">${tpl.category || 'UTILITY'}</span>
          </div>
          <span class="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
            ${tpl.status || 'APPROVED'}
          </span>
        </div>
        <p class="text-xs text-slate-600 line-clamp-2 leading-relaxed">${bodyText}</p>
        <div class="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-400">
          <span>Idioma: <b>${tpl.language}</b></span>
          <span>Variáveis detectadas: <b>${(bodyText.match(/\{\{\d+\}\}/g) || []).length}</b></span>
        </div>
      </div>
    `;
  }).join('');
}

function selectTemplate(templateName) {
  state.selectedTemplate = state.templates.find(t => t.name === templateName);
  renderTemplatesCards();

  const nextBtn = document.getElementById('btn-step2-next');
  if (nextBtn) nextBtn.disabled = false;

  // Atualiza balão do WhatsApp
  updateWhatsAppPreview(state.selectedTemplate);
}

function updateWhatsAppPreview(tpl) {
  if (!tpl) return;

  const headerComp = tpl.components.find(c => c.type === 'HEADER');
  const bodyComp = tpl.components.find(c => c.type === 'BODY');
  const footerComp = tpl.components.find(c => c.type === 'FOOTER');

  const headerEl = document.getElementById('preview-bubble-header');
  const bodyEl = document.getElementById('preview-bubble-body');
  const footerEl = document.getElementById('preview-bubble-footer');

  if (headerComp && headerComp.text) {
    headerEl.textContent = headerComp.text;
    headerEl.classList.remove('hidden');
  } else {
    headerEl.classList.add('hidden');
  }

  bodyEl.textContent = bodyComp ? bodyComp.text : 'Mensagem sem corpo.';

  if (footerComp && footerComp.text) {
    footerEl.textContent = footerComp.text;
    footerEl.classList.remove('hidden');
  } else {
    footerEl.classList.add('hidden');
  }
}

// ----------------------------------------------------
// 3. MAPEAMENTO DE VARIÁVEIS
// ----------------------------------------------------
function renderVariableMapping() {
  const container = document.getElementById('variable-mapping-container');
  if (!state.selectedTemplate) return;

  const bodyComp = state.selectedTemplate.components.find(c => c.type === 'BODY') || {};
  const bodyText = bodyComp.text || '';
  const matches = bodyText.match(/\{\{(\d+)\}\}/g) || [];
  const uniqueVars = [...new Set(matches.map(m => m.replace(/\D/g, '')))].sort((a, b) => parseInt(a) - parseInt(b));

  if (uniqueVars.length === 0) {
    container.innerHTML = `
      <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500">
        Este template não possui variáveis dinâmicas no corpo da mensagem. O texto será enviado de forma fixa a todos os contatos.
      </div>
    `;
    updateMappedMessageExample();
    return;
  }

  container.innerHTML = uniqueVars.map(varNum => {
    return `
      <div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
        <div class="flex items-center space-x-2">
          <span class="w-7 h-7 rounded-lg bg-emerald-600 text-white font-mono text-xs font-bold flex items-center justify-center">
            {{${varNum}}}
          </span>
          <span class="text-xs font-semibold text-slate-700">Variável {{${varNum}}}</span>
        </div>

        <div class="flex items-center space-x-2">
          <span class="text-xs text-slate-400">Preencher com:</span>
          <select id="map-var-${varNum}" onchange="onVariableMappingChange('${varNum}', this.value)" class="text-xs font-medium border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-800">
            <option value="">Selecione uma coluna...</option>
            ${state.parsedContacts.headers.map(h => `
              <option value="${h}" ${autoMatchColumn(varNum, h) ? 'selected' : ''}>${h}</option>
            `).join('')}
          </select>
        </div>
      </div>
    `;
  }).join('');

  // Inicializa mapa
  uniqueVars.forEach(varNum => {
    const sel = document.getElementById(`map-var-${varNum}`);
    if (sel && sel.value) {
      state.variableMapping[varNum] = sel.value;
    }
  });

  updateMappedMessageExample();
}

function autoMatchColumn(varNum, headerName) {
  const h = headerName.toLowerCase();
  if (varNum === '1' && (h.includes('nome') || h.includes('name') || h.includes('cliente'))) return true;
  if (varNum === '2' && (h.includes('codigo') || h.includes('código') || h.includes('pedido') || h.includes('data') || h.includes('cupom'))) return true;
  if (varNum === '3' && (h.includes('valor') || h.includes('horario') || h.includes('data') || h.includes('vencimento'))) return true;
  return false;
}

function onVariableMappingChange(varNum, columnName) {
  state.variableMapping[varNum] = columnName;
  updateMappedMessageExample();
}

function updateMappedMessageExample() {
  const exampleEl = document.getElementById('mapped-message-example');
  if (!state.selectedTemplate || !state.parsedContacts) return;

  const sampleRow = state.parsedContacts.validContacts[0]?.customData || {};
  let bodyText = state.selectedTemplate.components.find(c => c.type === 'BODY')?.text || '';

  // Substitui cada {{X}} pelo valor correspondente do primeiro contato
  Object.keys(state.variableMapping).forEach(varNum => {
    const col = state.variableMapping[varNum];
    const val = col && sampleRow[col] !== undefined ? sampleRow[col] : `[${col || 'Vazio'}]`;
    bodyText = bodyText.replaceAll(`{{${varNum}}}`, val);
  });

  exampleEl.textContent = bodyText;
}

// ----------------------------------------------------
// 4. REVISÃO E DISPARO
// ----------------------------------------------------
function renderReviewSummary() {
  document.getElementById('review-total-contacts').textContent = state.parsedContacts.validContacts.length;
  document.getElementById('review-template-name').textContent = state.selectedTemplate.name;
  document.getElementById('review-template-lang').textContent = state.selectedTemplate.language;

  const nameInput = document.getElementById('campaign-name-input');
  if (!nameInput.value) {
    const dateStr = new Date().toLocaleDateString('pt-BR');
    nameInput.value = `Disparo ${state.selectedTemplate.name} - ${dateStr}`;
  }

  // Indicador de simulação
  const isSim = state.settings.simulation_mode;
  const simText = document.getElementById('review-simulation-text');
  const simPill = document.getElementById('review-simulation-pill');
  if (isSim) {
    simText.textContent = 'Sandbox / Simulado (Sem custo)';
    simPill.className = 'text-xs font-bold px-3 py-2.5 rounded-xl border bg-amber-50 text-amber-800 border-amber-200 flex items-center';
  } else {
    simText.textContent = 'Oficial Meta API (Disparo Real)';
    simPill.className = 'text-xs font-bold px-3 py-2.5 rounded-xl border bg-emerald-50 text-emerald-800 border-emerald-200 flex items-center';
  }
}

function toggleTimingChoice(isScheduled) {
  const labelNow = document.getElementById('timing-label-now');
  const labelLater = document.getElementById('timing-label-later');
  const dtBox = document.getElementById('timing-datetime-box');
  const btnText = document.getElementById('btn-start-campaign-text');
  const btnIcon = document.getElementById('btn-start-campaign-icon');

  if (isScheduled) {
    if (labelLater) labelLater.className = 'flex items-center p-3 rounded-xl border cursor-pointer transition bg-purple-50 border-purple-300';
    if (labelNow) labelNow.className = 'flex items-center p-3 rounded-xl border cursor-pointer transition bg-white border-slate-200';
    if (dtBox) dtBox.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Confirmar Agendamento';
    if (btnIcon) btnIcon.setAttribute('data-lucide', 'calendar');

    const dtInput = document.getElementById('campaign-scheduled-time');
    if (dtInput && !dtInput.value) {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      const isoLocal = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      dtInput.value = isoLocal;
      dtInput.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
  } else {
    if (labelNow) labelNow.className = 'flex items-center p-3 rounded-xl border cursor-pointer transition bg-emerald-50 border-emerald-300';
    if (labelLater) labelLater.className = 'flex items-center p-3 rounded-xl border cursor-pointer transition bg-white border-slate-200';
    if (dtBox) dtBox.classList.add('hidden');
    if (btnText) btnText.textContent = 'Iniciar Disparo Imediato';
    if (btnIcon) btnIcon.setAttribute('data-lucide', 'rocket');
  }

  if (window.lucide) lucide.createIcons();
}

async function submitAndStartCampaign() {
  const name = document.getElementById('campaign-name-input').value.trim();
  const delayMs = parseInt(document.getElementById('campaign-delay-select').value) || 1000;
  const timingChoice = document.querySelector('input[name="timing-choice"]:checked')?.value || 'now';
  const isScheduled = timingChoice === 'later';

  if (!name) {
    alert('Por favor, informe um nome para a campanha.');
    return;
  }

  let scheduledAt = null;
  if (isScheduled) {
    const timeVal = document.getElementById('campaign-scheduled-time').value;
    if (!timeVal) {
      alert('Por favor, selecione a data e o horário para o disparo agendado.');
      return;
    }
    const scheduledDate = new Date(timeVal);
    if (isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      alert('A data de agendamento deve ser no futuro.');
      return;
    }
    scheduledAt = scheduledDate.toISOString();
  }

  // Se o usuário optou por salvar os contatos como Audiência
  const saveAsAudience = document.getElementById('chk-save-as-audience')?.checked;
  if (saveAsAudience) {
    const audName = document.getElementById('save-audience-name-input')?.value.trim() || name;
    try {
      await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: audName,
          description: `Criada a partir da campanha ${name}`,
          contacts: state.parsedContacts.validContacts
        })
      });
    } catch (err) {
      console.warn('Erro ao salvar audiência:', err);
    }
  }

  // Validação de Consentimento LGPD
  const consentChk = document.getElementById('chk-lgpd-consent');
  if (consentChk && !consentChk.checked) {
    alert('Por favor, confirme que possui a autorização/consentimento prévio dos destinatários (Opt-In).');
    return;
  }
  const consentSource = document.getElementById('consent-source-select')?.value || 'WEBSITE_FORM';

  const payload = {
    name,
    templateName: state.selectedTemplate.name,
    templateLanguage: state.selectedTemplate.language,
    delayMs,
    parametersMapping: state.variableMapping,
    contacts: state.parsedContacts.validContacts,
    scheduledAt,
    consentSource
  };

  try {
    // 1. Cria a campanha
    const resCreate = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const createData = await resCreate.json();
    if (!resCreate.ok) throw new Error(createData.error);

    const campaignId = createData.campaignId;

    if (isScheduled) {
      // 2a. Agenda a campanha
      await fetch(`/api/campaigns/${campaignId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt })
      });

      alert(`✅ Campanha "${name}" agendada com sucesso!\nHorário de início: ${new Date(scheduledAt).toLocaleString('pt-BR')}\nO sistema iniciará os envios automaticamente.`);
      switchTab('campaigns');
    } else {
      // 2b. Inicia imediatamente
      await fetch(`/api/campaigns/${campaignId}/start`, { method: 'POST' });
      alert('Campanha iniciada com sucesso! Redirecionando para acompanhamento...');
      switchTab('campaigns');
      openCampaignModal(campaignId);
    }
  } catch (err) {
    alert('Erro ao salvar campanha: ' + err.message);
  }
}

// ----------------------------------------------------
// 5. LISTA DE CAMPANHAS E AÇÕES
// ----------------------------------------------------
async function loadAllCampaigns(silent = false) {
  try {
    const res = await fetch('/api/campaigns');
    const campaigns = await res.json();
    renderCampaignsTable(campaigns);
  } catch (err) {
    if (!silent) console.error('Erro ao listar campanhas:', err);
  }
}

function renderCampaignsTable(campaigns) {
  const tbody = document.getElementById('all-campaigns-tbody');
  if (!tbody) return;

  if (campaigns.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="px-6 py-8 text-center text-slate-400">
          Nenhuma campanha criada ainda. Clique em "Novo Disparo" para começar.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = campaigns.map(c => {
    // Status Badge
    let statusClass = 'bg-slate-100 text-slate-700';
    if (c.status === 'RUNNING') statusClass = 'bg-blue-100 text-blue-800 animate-pulse';
    if (c.status === 'COMPLETED') statusClass = 'bg-emerald-100 text-emerald-800';
    if (c.status === 'PAUSED') statusClass = 'bg-amber-100 text-amber-800';
    if (c.status === 'CANCELED') statusClass = 'bg-rose-100 text-rose-800';
    if (c.status === 'SCHEDULED') statusClass = 'bg-purple-100 text-purple-800 font-bold';

    const progress = Math.min(100, Math.round((c.sent_count / (c.total_contacts || 1)) * 100));

    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="px-6 py-4 font-mono text-xs text-slate-400">#${c.id}</td>
        <td class="px-6 py-4">
          <span class="font-bold text-slate-900 block">${c.name}</span>
          <span class="text-[11px] text-slate-400">${new Date(c.created_at).toLocaleString('pt-BR')}</span>
          ${c.status === 'SCHEDULED' && c.scheduled_at ? `
            <span class="text-[10px] text-purple-700 font-bold flex items-center mt-0.5">
              <i data-lucide="clock" class="w-3 h-3 mr-1 inline"></i>
              Agendada: ${new Date(c.scheduled_at).toLocaleString('pt-BR')}
            </span>
          ` : ''}
        </td>
        <td class="px-6 py-4">
          <span class="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">${c.template_name}</span>
        </td>
        <td class="px-6 py-4">
          <span class="text-xs font-bold px-2.5 py-1 rounded-full ${statusClass}">${c.status}</span>
        </td>
        <td class="px-6 py-4 w-44">
          <div class="flex items-center justify-between text-[11px] text-slate-600 mb-1">
            <span>${c.sent_count}/${c.total_contacts}</span>
            <span class="font-bold">${progress}%</span>
          </div>
          <div class="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
            <div class="bg-emerald-500 h-1.5 rounded-full transition-all duration-300" style="width: ${progress}%"></div>
          </div>
        </td>
        <td class="px-6 py-4 text-xs font-medium">
          <span class="text-blue-600" title="Enviadas">${c.sent_count}</span> /
          <span class="text-emerald-600" title="Entregues">${c.delivered_count}</span> /
          <span class="text-indigo-600" title="Lidas">${c.read_count}</span> /
          <span class="text-rose-600" title="Falhas">${c.failed_count}</span>
        </td>
        <td class="px-6 py-4 text-right space-x-1 whitespace-nowrap">
          ${c.status === 'SCHEDULED' ? `
            <button onclick="startScheduledNow(${c.id})" class="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Disparar Agora Sem Esperar">
              <i data-lucide="play" class="w-4 h-4"></i>
            </button>
            <button onclick="cancelScheduledCampaign(${c.id})" class="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg" title="Cancelar Agendamento">
              <i data-lucide="x-circle" class="w-4 h-4"></i>
            </button>
          ` : ''}
          ${c.status === 'RUNNING' ? `
            <button onclick="pauseCampaign(${c.id})" class="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg" title="Pausar">
              <i data-lucide="pause" class="w-4 h-4"></i>
            </button>
          ` : ''}
          ${c.status === 'PAUSED' ? `
            <button onclick="resumeCampaign(${c.id})" class="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Retomar">
              <i data-lucide="play" class="w-4 h-4"></i>
            </button>
          ` : ''}
          <button onclick="openCampaignModal(${c.id})" class="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg" title="Ver Detalhes & Logs">
            <i data-lucide="eye" class="w-4 h-4"></i>
          </button>
          <a href="/api/campaigns/${c.id}/export" download class="inline-block p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg" title="Baixar Excel">
            <i data-lucide="download" class="w-4 h-4"></i>
          </a>
          <button onclick="deleteCampaign(${c.id})" class="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg" title="Excluir">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

async function startScheduledNow(id) {
  if (!confirm('Deseja iniciar o disparo desta campanha agendada agora mesmo?')) return;
  await fetch(`/api/campaigns/${id}/start`, { method: 'POST' });
  loadAllCampaigns();
}

async function cancelScheduledCampaign(id) {
  if (!confirm('Deseja cancelar o agendamento desta campanha?')) return;
  await fetch(`/api/campaigns/${id}/pause`, { method: 'POST' });
  loadAllCampaigns();
}

async function pauseCampaign(id) {
  await fetch(`/api/campaigns/${id}/pause`, { method: 'POST' });
  loadAllCampaigns();
}

async function resumeCampaign(id) {
  await fetch(`/api/campaigns/${id}/resume`, { method: 'POST' });
  loadAllCampaigns();
}

async function deleteCampaign(id) {
  if (!confirm('Deseja realmente excluir esta campanha e todo o seu histórico de envios?')) return;
  await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
  loadAllCampaigns();
  loadDashboardStats();
}

// ----------------------------------------------------
// 6. MODAL DE DETALHES DA CAMPANHA
// ----------------------------------------------------
async function openCampaignModal(campaignId) {
  state.activeModalCampaignId = campaignId;
  document.getElementById('campaign-details-modal').classList.remove('hidden');
  document.getElementById('modal-btn-export').onclick = () => {
    window.location.href = `/api/campaigns/${campaignId}/export`;
  };
  await loadModalMessages();
}

function closeCampaignModal() {
  state.activeModalCampaignId = null;
  document.getElementById('campaign-details-modal').classList.add('hidden');
}

async function loadModalMessages(silent = false) {
  if (!state.activeModalCampaignId) return;

  const filter = document.getElementById('modal-status-filter').value;
  try {
    const res = await fetch(`/api/campaigns/${state.activeModalCampaignId}?status=${filter}&limit=100`);
    const data = await res.json();
    const c = data.campaign;

    document.getElementById('modal-campaign-title').textContent = c.name;
    document.getElementById('modal-campaign-subtitle').textContent = `Template: ${c.template_name} (${c.template_language}) • Status: ${c.status}`;

    document.getElementById('modal-stat-total').textContent = c.total_contacts;
    document.getElementById('modal-stat-sent').textContent = c.sent_count;
    document.getElementById('modal-stat-delivered').textContent = `${c.delivered_count} (${c.read_count} lidas)`;
    document.getElementById('modal-stat-failed').textContent = c.failed_count;

    const tbody = document.getElementById('modal-messages-tbody');
    if (data.messages.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-6 text-center text-slate-400">Nenhum registro encontrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.messages.map(m => {
      let statusColor = 'text-slate-500 bg-slate-100';
      if (m.status === 'SENT') statusColor = 'text-blue-700 bg-blue-100';
      if (m.status === 'DELIVERED') statusColor = 'text-emerald-700 bg-emerald-100';
      if (m.status === 'READ') statusColor = 'text-indigo-700 bg-indigo-100';
      if (m.status === 'FAILED') statusColor = 'text-rose-700 bg-rose-100';

      const time = m.read_at || m.delivered_at || m.sent_at || m.created_at;

      return `
        <tr>
          <td class="px-4 py-2 font-medium text-slate-800">${m.name || 'Cliente'}</td>
          <td class="px-4 py-2 font-mono text-slate-600">${m.phone}</td>
          <td class="px-4 py-2">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor}">${m.status}</span>
          </td>
          <td class="px-4 py-2 text-slate-500">${time ? new Date(time).toLocaleTimeString('pt-BR') : '-'}</td>
          <td class="px-4 py-2 font-mono text-[11px] text-slate-500">
            ${m.status === 'FAILED' 
              ? `<span class="text-rose-600 font-sans">${m.error_message || 'Erro'}</span>`
              : (m.wamid ? `<span title="${m.wamid}">${m.wamid.substring(0, 24)}...</span>` : '-')}
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    if (!silent) console.error(err);
  }
}

// ----------------------------------------------------
// 7. DASHBOARD STATS
// ----------------------------------------------------
async function loadDashboardStats(silent = false) {
  try {
    const res = await fetch('/api/dashboard/stats');
    const data = await res.json();

    document.getElementById('stat-total-contacts').textContent = data.totalContacts.toLocaleString();
    document.getElementById('stat-total-sent').textContent = data.totalSent.toLocaleString();
    document.getElementById('stat-total-delivered').textContent = data.totalDelivered.toLocaleString();
    document.getElementById('stat-delivery-rate').textContent = `${data.deliveryRate}%`;
    document.getElementById('stat-total-read').textContent = data.totalRead.toLocaleString();
    document.getElementById('stat-read-rate').textContent = `${data.readRate}%`;
    document.getElementById('stat-total-failed').textContent = data.totalFailed.toLocaleString();

    // Tabela resumida no dashboard
    const tbody = document.getElementById('dashboard-campaigns-tbody');
    if (tbody && data.recentCampaigns) {
      if (data.recentCampaigns.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-6 text-center text-slate-400">Nenhuma campanha recente.</td></tr>`;
      } else {
        tbody.innerHTML = data.recentCampaigns.map(c => {
          let statusPill = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700"><span class="w-1.5 h-1.5 rounded-full bg-slate-400 mr-1.5"></span>${c.status}</span>`;
          if (c.status === 'COMPLETED') {
            statusPill = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800"><span class="w-1.5 h-1.5 rounded-full bg-[#059669] mr-1.5"></span>Concluída</span>`;
          } else if (c.status === 'RUNNING' || c.status === 'PROCESSING') {
            statusPill = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800"><span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse mr-1.5"></span>Em andamento</span>`;
          } else if (c.status === 'PAUSED') {
            statusPill = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5"></span>Pausada</span>`;
          } else if (c.status === 'SCHEDULED') {
            statusPill = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800"><span class="w-1.5 h-1.5 rounded-full bg-purple-500 mr-1.5"></span>Agendada</span>`;
          } else if (c.status === 'FAILED' || c.status === 'CANCELED') {
            statusPill = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800"><span class="w-1.5 h-1.5 rounded-full bg-rose-500 mr-1.5"></span>Falha</span>`;
          }

          return `
          <tr class="hover:bg-slate-50 transition">
            <td class="px-6 py-3.5 font-bold text-slate-900">${c.name}</td>
            <td class="px-6 py-3.5 font-mono text-xs text-slate-500">${c.template_name}</td>
            <td class="px-6 py-3.5">${statusPill}</td>
            <td class="px-6 py-3.5 text-xs font-semibold text-slate-700">${c.sent_count} / ${c.total_contacts} (${c.progress_percent || 0}%)</td>
            <td class="px-6 py-3.5 text-xs text-slate-500">${c.read_count} lidas de ${c.delivered_count} entregues</td>
            <td class="px-6 py-3.5 text-right">
              <button onclick="openCampaignModal(${c.id})" class="text-xs font-bold text-[#059669] hover:underline">Detalhes</button>
            </td>
          </tr>
        `;
        }).join('');
      }
    }
  } catch (err) {
    if (!silent) console.error(err);
  }
}

// ----------------------------------------------------
// 8. CATÁLOGO DE TEMPLATES E TESTE RÁPIDO
// ----------------------------------------------------
function renderTemplatesCatalog() {
  const grid = document.getElementById('templates-catalog-grid');
  if (!grid) return;

  if (state.templates.length === 0) {
    grid.innerHTML = `<div class="col-span-3 text-center py-8 text-slate-400">Nenhum template em cache. Clique em "Sincronizar da Meta".</div>`;
    return;
  }

  grid.innerHTML = state.templates.map(tpl => {
    const bodyComp = tpl.components?.find(c => c.type === 'BODY') || {};
    const headerComp = tpl.components?.find(c => c.type === 'HEADER');
    const footerComp = tpl.components?.find(c => c.type === 'FOOTER');

    return `
      <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between hover:border-slate-300 transition">
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="font-bold text-sm text-slate-900">${tpl.name}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">${tpl.category}</span>
          </div>
          ${headerComp?.text ? `<p class="text-[11px] font-bold text-slate-700 mb-1">${headerComp.text}</p>` : ''}
          <p class="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100 whitespace-pre-wrap">${bodyComp.text || ''}</p>
          ${footerComp?.text ? `<p class="text-[10px] text-slate-400 mt-1 italic">${footerComp.text}</p>` : ''}
        </div>
        <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <div>
            <span>Idioma: <b>${tpl.language}</b></span>
            <span class="text-emerald-600 font-bold ml-1">● Aprovado</span>
          </div>
          <button onclick="deleteTemplate('${tpl.name}')" class="p-1 text-rose-500 hover:bg-rose-50 rounded" title="Excluir Template da Meta">
            <i data-lucide="trash-2" class="w-3.5 h-3.5 inline"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function populateQuickTestTemplates() {
  const select = document.getElementById('quick-test-template');
  if (!select) return;
  select.innerHTML = state.templates.map(t => `<option value="${t.name}">${t.name} (${t.language})</option>`).join('');
}

async function sendQuickTestMessage() {
  const phone = document.getElementById('quick-test-phone').value.trim();
  const templateName = document.getElementById('quick-test-template').value;
  const feedback = document.getElementById('quick-test-feedback');

  if (!phone) {
    alert('Informe seu telefone com DDD.');
    return;
  }

  feedback.className = 'mt-2 text-xs font-medium text-slate-600 block';
  feedback.textContent = 'Enviando teste...';

  try {
    const res = await fetch('/api/templates/test-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: phone,
        templateName,
        parameters: ['Cliente Teste', 'TESTE-999', 'R$ 100,00']
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.success) {
      feedback.className = 'mt-2 text-xs font-medium text-emerald-600 block';
      feedback.textContent = `✅ Mensagem enviada com sucesso! ID: ${data.messageId} ${data.isSimulated ? '(Simulado)' : '(Meta Oficial)'}`;
    } else {
      feedback.className = 'mt-2 text-xs font-medium text-rose-600 block';
      feedback.textContent = `❌ Erro no envio: ${data.error}`;
    }
  } catch (err) {
    feedback.className = 'mt-2 text-xs font-medium text-rose-600 block';
    feedback.textContent = `❌ Falha na requisição: ${err.message}`;
  }
}

// ----------------------------------------------------
// 9. CONFIGURAÇÕES & CONEXÃO COM A GRAPH API
// ----------------------------------------------------
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    state.settings = data;

    document.getElementById('setting-access-token').value = data.meta_access_token || '';
    document.getElementById('setting-phone-id').value = data.meta_phone_number_id || '';
    document.getElementById('setting-waba-id').value = data.meta_waba_id || '';
    document.getElementById('setting-api-version').value = data.meta_api_version || 'v21.0';
    document.getElementById('setting-verify-token').value = data.meta_verify_token || '';
    if (document.getElementById('display-verify-token')) {
      document.getElementById('display-verify-token').value = data.meta_verify_token || '';
    }
    document.getElementById('setting-simulation-mode').checked = data.simulation_mode;

    updateMetaStatusPill(data.simulation_mode, !!(data.meta_access_token && data.meta_phone_number_id));
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

function copyToClipboard(text, successMsg = 'Copiado!') {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    alert(successMsg);
  }).catch(() => {
    prompt('Copie o texto abaixo:', text);
  });
}

function updateMetaStatusPill(isSimulation, hasCredentials) {
  const pill = document.getElementById('meta-status-pill');
  const text = document.getElementById('meta-status-text');

  if (isSimulation) {
    pill.className = 'flex items-center space-x-2 text-xs font-medium px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200';
    text.textContent = 'Modo Simulação (Sandbox)';
  } else if (hasCredentials) {
    pill.className = 'flex items-center space-x-2 text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200';
    text.textContent = 'Conectado à Meta Oficial';
  } else {
    pill.className = 'flex items-center space-x-2 text-xs font-medium px-3 py-1.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200';
    text.textContent = 'Credenciais Pendentes';
  }
}

async function saveSettings(silent = false) {
  const payload = {
    meta_access_token: document.getElementById('setting-access-token').value.trim(),
    meta_phone_number_id: document.getElementById('setting-phone-id').value.trim(),
    meta_waba_id: document.getElementById('setting-waba-id').value.trim(),
    meta_api_version: document.getElementById('setting-api-version').value.trim(),
    meta_verify_token: document.getElementById('setting-verify-token').value.trim(),
    simulation_mode: document.getElementById('setting-simulation-mode').checked
  };

  const feedbackDiv = document.getElementById('settings-save-feedback');

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    await loadSettings();

    if (feedbackDiv) {
      feedbackDiv.className = 'inline-flex items-center text-xs font-bold text-emerald-700 bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg';
      feedbackDiv.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5 mr-1"></i> Salvo com sucesso no banco de dados!';
      feedbackDiv.classList.remove('hidden');
      setTimeout(() => feedbackDiv.classList.add('hidden'), 4000);
      if (window.lucide) lucide.createIcons();
    } else if (!silent) {
      alert('Configurações salvas com sucesso!');
    }
  } catch (err) {
    if (feedbackDiv) {
      feedbackDiv.className = 'inline-flex items-center text-xs font-bold text-rose-700 bg-rose-100 border border-rose-200 px-3 py-1.5 rounded-lg';
      feedbackDiv.textContent = 'Erro ao salvar: ' + err.message;
      feedbackDiv.classList.remove('hidden');
    } else {
      alert('Erro ao salvar: ' + err.message);
    }
  }
}

async function testMetaConnection() {
  const resultDiv = document.getElementById('connection-test-result');
  resultDiv.classList.remove('hidden');
  resultDiv.className = 'p-4 rounded-xl text-xs space-y-2 mt-4 bg-slate-100 text-slate-700 border border-slate-200';
  resultDiv.innerHTML = 'Testando conexão com os servidores da Meta...';

  const token = document.getElementById('setting-access-token').value.trim();
  const phoneId = document.getElementById('setting-phone-id').value.trim();
  const wabaId = document.getElementById('setting-waba-id').value.trim();
  const isSimulation = document.getElementById('setting-simulation-mode').checked;

  const payload = {
    accessToken: token,
    phoneNumberId: phoneId,
    wabaId: wabaId,
    apiVersion: document.getElementById('setting-api-version').value.trim(),
    simulationMode: isSimulation
  };

  try {
    const res = await fetch('/api/settings/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      // Auto-salva quando o teste da conexão for bem-sucedido!
      await saveSettings(true);

      resultDiv.className = 'p-4 rounded-xl text-xs space-y-2 mt-4 bg-emerald-50 text-emerald-900 border border-emerald-200';
      resultDiv.innerHTML = `
        <div class="font-bold text-sm flex items-center text-emerald-800">
          <i data-lucide="check-circle" class="w-4 h-4 mr-2"></i>
          ${data.message}
        </div>
        <div class="text-[11px] text-emerald-700 font-medium">
          ✅ As credenciais foram validadas e <b>salvas automaticamente</b> no banco de dados!
        </div>
        <div class="grid grid-cols-2 gap-2 pt-2 border-t border-emerald-200/60">
          <div>Número: <b>${data.details.displayPhoneNumber}</b></div>
          <div>Nome Verificado: <b>${data.details.verifiedName}</b></div>
          <div>Qualidade: <b>${data.details.qualityRating}</b></div>
          <div>Limite (Tier): <b>${data.details.messagingLimitTier}</b></div>
        </div>
      `;
    } else {
      resultDiv.className = 'p-4 rounded-xl text-xs space-y-2 mt-4 bg-rose-50 text-rose-900 border border-rose-200';
      resultDiv.innerHTML = `
        <div class="font-bold text-sm flex items-center text-rose-800">
          <i data-lucide="alert-octagon" class="w-4 h-4 mr-2"></i>
          Falha na conexão com a Meta
        </div>
        <p class="pt-1">${data.error}</p>
      `;
    }

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    resultDiv.className = 'p-4 rounded-xl text-xs space-y-2 mt-4 bg-rose-50 text-rose-900 border border-rose-200';
    resultDiv.innerHTML = `Falha na requisição: ${err.message}`;
  }
}

// ----------------------------------------------------
// 10. GESTÃO DE AUDIÊNCIAS / LISTAS SALVAS
// ----------------------------------------------------
async function loadAudiences() {
  const grid = document.getElementById('audiences-grid');
  if (!grid) return;

  try {
    const res = await fetch('/api/lists');
    const lists = await res.json();
    state.audiences = lists;

    if (lists.length === 0) {
      grid.innerHTML = `
        <div class="col-span-3 text-center py-12 bg-white rounded-xl border border-slate-200">
          <div class="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <i data-lucide="users" class="w-6 h-6"></i>
          </div>
          <h4 class="font-bold text-slate-700 text-sm">Nenhuma lista salva ainda</h4>
          <p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Ao importar uma lista de contatos em "Novo Disparo", marque a opção "Salvar como Lista Salva" para reutilizá-la aqui.
          </p>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    grid.innerHTML = lists.map(l => `
      <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between hover:border-emerald-200 transition">
        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-bold text-sm text-slate-900 truncate">${l.name}</h3>
            <span class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
              ${l.contact_count} contatos
            </span>
          </div>
          <p class="text-xs text-slate-500 mb-4">${l.description || 'Lista de contatos importada'}</p>
        </div>

        <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          <span class="text-[11px] text-slate-400">${new Date(l.created_at).toLocaleDateString('pt-BR')}</span>
          <div class="space-x-1">
            <button onclick="openAudienceModal(${l.id})" class="px-2.5 py-1 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded font-medium transition" title="Ver Contatos">
              Ver
            </button>
            <button onclick="useAudienceInDispatch(${l.id})" class="px-2.5 py-1 text-white bg-emerald-600 hover:bg-emerald-700 rounded font-bold transition" title="Usar em Novo Disparo">
              Disparar
            </button>
            <button onclick="deleteAudienceList(${l.id}, '${l.name}')" class="p-1 text-rose-500 hover:bg-rose-50 rounded" title="Excluir">
              <i data-lucide="trash-2" class="w-3.5 h-3.5 inline"></i>
            </button>
          </div>
        </div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Erro ao carregar audiências:', err);
  }
}

async function openAudienceModal(listId) {
  try {
    const res = await fetch(`/api/lists/${listId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    document.getElementById('audience-modal-title').textContent = data.list.name;
    document.getElementById('audience-modal-subtitle').textContent = `${data.items.length} contatos cadastrados • Criada em ${new Date(data.list.created_at).toLocaleDateString('pt-BR')}`;

    const tbody = document.getElementById('audience-modal-tbody');
    if (data.items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="px-4 py-4 text-center text-slate-400">Nenhum contato nesta lista.</td></tr>';
    } else {
      tbody.innerHTML = data.items.map(item => {
        let customObj = {};
        try { customObj = JSON.parse(item.custom_data || '{}'); } catch (e) {}
        const extraText = Object.entries(customObj)
          .filter(([k]) => k !== 'Nome' && k !== 'Telefone')
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ') || '-';

        return `
          <tr class="hover:bg-slate-50">
            <td class="px-4 py-2 font-medium text-slate-800">${item.name || 'Sem nome'}</td>
            <td class="px-4 py-2 font-mono text-slate-600">${item.phone}</td>
            <td class="px-4 py-2 text-slate-500 truncate max-w-xs">${extraText}</td>
          </tr>
        `;
      }).join('');
    }

    const btnUse = document.getElementById('btn-use-audience-in-dispatch');
    if (btnUse) {
      btnUse.onclick = () => useAudienceInDispatch(listId);
    }

    document.getElementById('audience-detail-modal').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    alert('Erro ao abrir detalhes da lista: ' + err.message);
  }
}

function closeAudienceModal() {
  document.getElementById('audience-detail-modal').classList.add('hidden');
}

async function useAudienceInDispatch(listId) {
  closeAudienceModal();
  switchTab('new-campaign');
  setContactSourceMode('saved');
  await loadSavedAudiencesDropdown();
  const select = document.getElementById('select-saved-audience');
  if (select) select.value = listId;
  await loadSelectedAudienceIntoWizard(listId);
}

async function deleteAudienceList(listId, name) {
  if (!confirm(`Deseja realmente excluir a lista "${name}" e todos os seus contatos?`)) return;
  try {
    const res = await fetch(`/api/lists/${listId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
    await loadAudiences();
  } catch (err) {
    alert('Erro ao excluir lista: ' + err.message);
  }
}

// ----------------------------------------------------
// 11. LISTA NEGRA & OPT-OUT ANTI-BAN
// ----------------------------------------------------
async function loadBlacklist() {
  try {
    const res = await fetch('/api/blacklist');
    const list = await res.json();
    state.blacklist = list;

    const badge = document.getElementById('blacklist-count-badge');
    if (badge) badge.textContent = `${list.length} contatos`;

    renderBlacklistTable(list);
  } catch (err) {
    console.error('Erro ao carregar lista negra:', err);
  }
}

function renderBlacklistTable(items) {
  const tbody = document.getElementById('blacklist-tbody');
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="px-6 py-8 text-center text-slate-400">
          Nenhum número na lista negra. Seus disparos estão liberados para todos os contatos.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map(b => {
    const isWebhook = b.source === 'WEBHOOK_OPTOUT';
    const sourceBadge = isWebhook
      ? '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-purple-100 text-purple-800">🤖 Resposta WhatsApp (Opt-Out)</span>'
      : '<span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 text-slate-700">👤 Bloqueio Manual</span>';

    return `
      <tr class="hover:bg-slate-50">
        <td class="px-6 py-3 font-mono font-bold text-slate-900">${b.phone}</td>
        <td class="px-6 py-3">${sourceBadge}</td>
        <td class="px-6 py-3 text-slate-600 font-medium">${b.reason || 'Opt-out solicitado'}</td>
        <td class="px-6 py-3 text-slate-400">${new Date(b.created_at).toLocaleString('pt-BR')}</td>
        <td class="px-6 py-3 text-right">
          <button onclick="removeBlacklistPhone('${b.phone}')" class="text-rose-600 hover:text-rose-800 font-bold hover:underline">
            Desbloquear
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function searchBlacklist(query) {
  if (!query || !query.trim()) {
    renderBlacklistTable(state.blacklist);
    return;
  }
  const q = query.toLowerCase().trim();
  const filtered = state.blacklist.filter(b => 
    b.phone.includes(q) || (b.reason && b.reason.toLowerCase().includes(q)) || (b.name && b.name.toLowerCase().includes(q))
  );
  renderBlacklistTable(filtered);
}

async function submitManualBlacklist() {
  const phoneInput = document.getElementById('manual-blacklist-phone');
  const reasonInput = document.getElementById('manual-blacklist-reason');

  const phone = phoneInput.value.trim();
  const reason = reasonInput.value.trim() || 'Bloqueio manual via painel';

  if (!phone) {
    alert('Por favor, informe o número de telefone a ser bloqueado.');
    return;
  }

  try {
    const res = await fetch('/api/blacklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, reason, source: 'MANUAL' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    phoneInput.value = '';
    reasonInput.value = '';
    await loadBlacklist();
    alert(`Número ${phone} bloqueado com sucesso na Lista Negra!`);
  } catch (err) {
    alert('Erro ao adicionar à lista negra: ' + err.message);
  }
}

async function removeBlacklistPhone(phone) {
  if (!confirm(`Deseja realmente desbloquear o telefone ${phone} e permitir futuros envios?`)) return;

  try {
    const res = await fetch(`/api/blacklist/${phone}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
    await loadBlacklist();
  } catch (err) {
    alert('Erro ao remover da lista negra: ' + err.message);
  }
}

// ----------------------------------------------------
// 12. CRIADOR E SUBMISOR DE TEMPLATES META
// ----------------------------------------------------
function openCreateTemplateModal() {
  document.getElementById('new-tpl-name').value = '';
  document.getElementById('new-tpl-category').value = 'UTILITY';
  document.getElementById('new-tpl-language').value = 'pt_BR';
  document.getElementById('new-tpl-header').value = '';
  document.getElementById('new-tpl-body').value = '';
  document.getElementById('new-tpl-footer').value = '';
  document.getElementById('new-tpl-btn-type').value = 'NONE';
  toggleButtonInputs('NONE');
  updateNewTemplatePreview();
  document.getElementById('create-template-modal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeCreateTemplateModal() {
  document.getElementById('create-template-modal').classList.add('hidden');
}

function sanitizeTemplateNameInput(input) {
  input.value = input.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function insertVariableIntoBody(tag) {
  const textarea = document.getElementById('new-tpl-body');
  const start = textarea.selectionStart || textarea.value.length;
  const end = textarea.selectionEnd || textarea.value.length;
  textarea.value = textarea.value.substring(0, start) + tag + textarea.value.substring(end);
  textarea.focus();
  textarea.setSelectionRange(start + tag.length, start + tag.length);
  updateNewTemplatePreview();
}

function toggleButtonInputs(type) {
  const btnText = document.getElementById('new-tpl-btn-text');
  const btnUrl = document.getElementById('new-tpl-btn-url');
  const previewBtn = document.getElementById('new-preview-button');

  if (type === 'NONE') {
    btnText.classList.add('hidden');
    btnUrl.classList.add('hidden');
    previewBtn.classList.add('hidden');
  } else if (type === 'QUICK_REPLY') {
    btnText.classList.remove('hidden');
    btnUrl.classList.add('hidden');
    previewBtn.classList.remove('hidden');
  } else if (type === 'URL') {
    btnText.classList.remove('hidden');
    btnUrl.classList.remove('hidden');
    previewBtn.classList.remove('hidden');
  }
  updateNewTemplatePreview();
}

function updateNewTemplatePreview() {
  const header = document.getElementById('new-tpl-header').value.trim();
  const body = document.getElementById('new-tpl-body').value;
  const footer = document.getElementById('new-tpl-footer').value.trim();
  const btnType = document.getElementById('new-tpl-btn-type').value;
  const btnText = document.getElementById('new-tpl-btn-text').value.trim();

  // Header Preview
  const pHeader = document.getElementById('new-preview-header');
  if (header) {
    pHeader.textContent = header;
    pHeader.classList.remove('hidden');
  } else {
    pHeader.classList.add('hidden');
  }

  // Body Preview
  const pBody = document.getElementById('new-preview-body');
  pBody.textContent = body || 'Digite o corpo da mensagem para visualizar...';

  // Footer Preview
  const pFooter = document.getElementById('new-preview-footer');
  if (footer) {
    pFooter.textContent = footer;
    pFooter.classList.remove('hidden');
  } else {
    pFooter.classList.add('hidden');
  }

  // Button Preview
  const pBtn = document.getElementById('new-preview-button');
  const pBtnText = document.getElementById('new-preview-button-text');
  if (btnType !== 'NONE' && btnText) {
    pBtnText.textContent = btnText;
    pBtn.classList.remove('hidden');
  } else if (btnType !== 'NONE') {
    pBtnText.textContent = btnType === 'URL' ? 'Acessar Link' : 'Responder';
    pBtn.classList.remove('hidden');
  } else {
    pBtn.classList.add('hidden');
  }

  if (window.lucide) lucide.createIcons();
}

async function submitNewTemplateToMeta() {
  const name = document.getElementById('new-tpl-name').value.trim();
  const category = document.getElementById('new-tpl-category').value;
  const language = document.getElementById('new-tpl-language').value;
  const headerText = document.getElementById('new-tpl-header').value.trim();
  const bodyText = document.getElementById('new-tpl-body').value.trim();
  const footerText = document.getElementById('new-tpl-footer').value.trim();
  const btnType = document.getElementById('new-tpl-btn-type').value;
  const btnText = document.getElementById('new-tpl-btn-text').value.trim();
  const btnUrl = document.getElementById('new-tpl-btn-url').value.trim();

  if (!name) {
    alert('Informe o nome do template (apenas minúsculas e sublinhados).');
    return;
  }
  if (!bodyText) {
    alert('O corpo da mensagem é obrigatório.');
    return;
  }
  if (btnType !== 'NONE' && !btnText) {
    alert('Informe o texto para o botão.');
    return;
  }
  if (btnType === 'URL' && !btnUrl) {
    alert('Informe a URL para o botão.');
    return;
  }

  const buttons = [];
  if (btnType === 'QUICK_REPLY') {
    buttons.push({ type: 'QUICK_REPLY', text: btnText });
  } else if (btnType === 'URL') {
    buttons.push({ type: 'URL', text: btnText, url: btnUrl });
  }

  const btnSubmit = document.getElementById('btn-submit-new-template');
  const originalHtml = btnSubmit.innerHTML;
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = 'Submetendo à Meta...';

  try {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        category,
        language,
        headerText,
        bodyText,
        footerText,
        buttons
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao submeter template');

    alert(`🎉 Template "${name}" submetido com sucesso para a aprovação da Meta!\nID do Template: ${data.id || 'Criado'}`);
    closeCreateTemplateModal();
    await loadTemplates();
    renderTemplatesCatalog();
  } catch (err) {
    alert('Erro ao submeter template para a Meta: ' + err.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = originalHtml;
    if (window.lucide) lucide.createIcons();
  }
}

async function deleteTemplate(templateName) {
  if (!confirm(`Deseja realmente excluir o template "${templateName}" diretamente da Meta?`)) return;

  try {
    const res = await fetch(`/api/templates/${templateName}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(`Template "${templateName}" excluído com sucesso!`);
    await loadTemplates();
    renderTemplatesCatalog();
  } catch (err) {
    alert('Erro ao excluir template: ' + err.message);
  }
}
