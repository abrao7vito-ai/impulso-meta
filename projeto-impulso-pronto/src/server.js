require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Middlewares
const { optionalAuth } = require('./middleware/auth');

// Rotas
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const campaignsRouter = require('./routes/campaigns');
const templatesRouter = require('./routes/templates');
const settingsRouter = require('./routes/settings');
const webhookRouter = require('./routes/webhook');
const dashboardRouter = require('./routes/dashboard');
const blacklistRouter = require('./routes/blacklist');
const contactsRouter = require('./routes/contacts');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares Globais
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Middleware de identificação de Tenant/User em rotas API
app.use('/api', optionalAuth);

// Arquivos estáticos da interface web e amostras
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/samples', express.static(path.join(__dirname, '..', 'samples')));

// Rotas da API
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/webhook', webhookRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/blacklist', blacklistRouter);
app.use('/api/lists', contactsRouter);

// Fallback para SPA
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint não encontrado' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Inicialização
app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 Plataforma SaaS DisparaZap Meta Cloud API Ativa!`);
  console.log(`🌐 Painel Web: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/api/webhook`);
  console.log('====================================================');
});
