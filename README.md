# 🚀 Sistema de Disparo com API Oficial do Meta (WhatsApp Cloud API)

Sistema completo, moderno e de alta performance para disparo de mensagens em massa utilizando a **API Oficial do WhatsApp (Meta Cloud API / Graph API)**.

---

## 🌟 Principais Recursos

- **Dashboard em Tempo Real:** Visualização de total de disparos, entregues, lidos, falhas e taxas de conversão.
- **Importação Flexível de Contatos:**
  - Suporta arquivos **Excel (.xlsx, .xls)** e **CSV**.
  - Opção para colar listas diretamente no painel.
  - Sanitização e validação automática de números (formatação padrão internacional E.164 com DDI 55 para o Brasil).
- **Sincronização de Templates Oficiais:**
  - Integração direta com a Meta Graph API (`message_templates`).
  - Pré-visualização idêntica ao app do WhatsApp.
  - Mapeamento dinâmico de variáveis (`{{1}}`, `{{2}}`, `{{3}}`) associando colunas da planilha aos campos do template.
- **Fila de Envio com Rate Limiting:**
  - Controle de intervalo e velocidade de disparo para proteger a qualidade do número (*Quality Rating*) e respeitar os limites de envio da Meta.
  - Ações para **Pausar**, **Retomar**, **Cancelar** e **Acompanhar** campanhas ao vivo.
- **Webhook Integrado:**
  - Rota `/api/webhook` pronta para receber eventos de status (`sent`, `delivered`, `read`, `failed`).
- **Modo Sandbox / Simulação:**
  - Permite testar todo o fluxo imediatamente mesmo antes de configurar as credenciais oficiais.
- **Exportação de Relatórios:**
  - Exporta relatórios completos dos disparos em formato **Excel (.xlsx)** com ID oficial de cada mensagem (`wamid`), datas e motivos de erro se houver.

---

## 📦 Instalação e Execução

### 1. Iniciar o servidor

No terminal, execute:

```bash
# Executar em modo de produção
npm start

# Ou em modo de desenvolvimento com recarregamento automático
npm run dev
```

O sistema estará disponível em:
👉 **Painel Web:** `http://localhost:3000`

---

## 🔑 Como Obter e Configurar as Credenciais da Meta

1. Acesse o portal de desenvolvedores: [developers.facebook.com](https://developers.facebook.com)
2. Crie ou selecione um aplicativo do tipo **Empresa (Business)**.
3. No menu lateral do aplicativo, adicione o produto **WhatsApp**.
4. Em **WhatsApp > Configuração da API**:
   - Copie o **Identificador do número de telefone** (`Phone Number ID`).
   - Copie o **Identificador da conta do WhatsApp Business** (`WABA ID`).
5. Para gerar um token permanente:
   - Acesse o [Gerenciador de Negócios da Meta](https://business.facebook.com/settings).
   - Vá em **Usuários do Sistema** > Adicione um usuário > Atribua o aplicativo do WhatsApp.
   - Gere um token com as permissões:
     - `whatsapp_business_messaging`
     - `whatsapp_business_management`
6. Cole as credenciais na aba **Configurações & API** dentro do painel web ou diretamente no arquivo `.env`.

---

## 🔗 Configuração do Webhook da Meta

Para receber os status em tempo real de mensagens **Entregues** e **Lidas**:

1. No painel de desenvolvedores da Meta, vá em **WhatsApp > Configuração > Webhook**.
2. Clique em **Editar**:
   - **URL de retorno de chamada:** `https://seu-dominio-publico.com/api/webhook` (ou URL do *ngrok* / *localtunnel* em ambiente local).
   - **Token de verificação:** Informe o token configurado no sistema (padrão: `token_disparo_meta_seguro_8f29`).
3. Em **Campos do Webhook**, clique em **Assinar** no campo `messages`.

---

## 🧪 Bateria de Testes Automatizados

Para rodar todos os testes de integração (importação, banco SQLite, motor de campanhas, webhook e exportação Excel):

```bash
npm test
```
