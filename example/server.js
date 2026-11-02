import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createMetaGuardMiddleware } from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));

// Static files for the demo web UI and the widget
app.use(express.static(path.join(__dirname, 'public')));
app.use('/widget', express.static(path.join(__dirname, '../src/widget')));

// Sample knowledge articles
const sampleKnowledge = [
  {
    id: 'kb_webhooks',
    title: 'Configuring Webhooks',
    category: 'Integrations',
    content: 'Webhooks can be registered via POST /api/webhooks with HMAC-SHA256 signature verification.',
    allowedRoles: ['USER', 'PRO', 'ADMIN'],
    keywords: ['webhook', 'events', 'hmac', 'integration']
  },
  {
    id: 'kb_api_keys',
    title: 'API Key Management',
    category: 'Authentication',
    content: 'Generate and revoke API keys from Settings > API. Keys are scoped and rate-limited.',
    allowedRoles: ['USER', 'PRO', 'ADMIN'],
    keywords: ['api', 'key', 'token', 'auth']
  }
];

// Sample tool definitions
const sampleTools = [
  {
    type: 'function',
    function: {
      name: 'get_account_status',
      description: 'Retrieves current account status, active tier, and remaining credits.',
      parameters: {
        type: 'object',
        properties: {
          includeDetails: { type: 'boolean' }
        }
      }
    }
  }
];

// Tool handlers
const toolHandlers = {
  get_account_status: async (args, req) => {
    return {
      status: 'ACTIVE',
      tier: 'PRO',
      creditsRemaining: 4850,
      verified: true
    };
  }
};

// Mount MetaGuard Agent Middleware at /api/agent
app.use(
  '/api/agent',
  createMetaGuardMiddleware({
    apiKey: process.env.META_MODEL_API_KEY,
    systemPrompt: `You are the AI Assistant for the platform. Provide concise and accurate guidance. Adhere strictly to the security guardrail.`,
    initialKnowledge: sampleKnowledge,
    tools: sampleTools,
    toolHandlers,
    getUserContext: (req) => ({
      userId: 'usr_demo_123',
      userRole: 'PRO',
      userName: 'Alice Smith'
    })
  })
);

app.listen(port, () => {
  console.log(`\n🛡️ MetaGuard Agent Demo Server running at: http://localhost:${port}`);
  console.log(`👉 Open your browser to test chat, security guardrails, and Computer Use.`);
  if (!process.env.META_MODEL_API_KEY) {
    console.log(`⚠️  Warning: META_MODEL_API_KEY is not set. Set it in .env to call live Meta AI models.\n`);
  }
});
