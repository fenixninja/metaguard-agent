# 🛡️ MetaGuard Agent

[![npm version](https://img.shields.io/badge/version-1.0.0-emerald.svg)](https://github.com/fenixninja/metaguard-agent)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![tests](https://img.shields.io/badge/tests-7%20passed-brightgreen.svg)](test/security.test.js)

Production-grade agent framework for the **Meta Model API** (`muse-spark-1.3`, `muse-wonder-1.0`). Designed with built-in **Computer Use (CUA)**, multi-layered security guardrails, zero-code enforcement, antimalware binary inspection, and conversational lockout harnesses.

---

## 🚀 Key Features

- **Meta Model API Integration:** First-class support for Meta AI models (`muse-spark-1.3` for low-latency reasoning and tools, `muse-wonder-1.0` for Computer Use visual actions).
- **Computer Use (CUA) Engine:** Full-stack visual coordinate navigation, screenshot capture, animated spotlight rings, and tactile click ripples.
- **Pre-LLM Security Guardrail (< 5ms):** High-speed regex classification intercepting jailbreaks, Unicode tag contraband, and out-of-domain queries before touching the LLM.
- **Conversational Lockout Harness:** 3-strike policy with automated 30-second cooldown periods (`HTTP 429`) and live countdown locks on the client.
- **Antimalware & Binary Magic Bytes Scanner:** Detects disguised Windows PE (`MZ`), Linux (`ELF`), shell scripts (`#!`), and embedded PDF JavaScript actions.
- **Three-Level Indirect Prompt Injection Defense:** Stops hidden instructions smuggled in documents, images, or audio memos via dynamic spotlight boundaries (`<untrusted_file_data_${id}>`) and intent verification on tool calls.
- **Zero-Code Policy Enforcement:** Pre- and post-LLM filters ensuring the agent navigates platforms without dumping source code in chat bubbles.
- **Plug-and-Play Storage Adapter:** In-memory by default, with an extensible `StorageAdapter` interface for PostgreSQL, Prisma, MongoDB, or SQLite.
- **Dual Distribution:** Node.js / Express backend middleware + lightweight vanilla JavaScript / ESM frontend chat widget with virtual cursor.

---

## 📦 Installation

```bash
npm install metaguard-agent
```

---

## 🛠️ Quickstart (Express Backend)

```javascript
import express from 'express';
import { createMetaGuardMiddleware } from 'metaguard-agent';

const app = express();
app.use(express.json({ limit: '15mb' }));

// Mount the MetaGuard agent routes
app.use('/api/agent', createMetaGuardMiddleware({
  apiKey: process.env.META_MODEL_API_KEY,
  systemPrompt: 'You are the helpful assistant for our platform. Answer user questions and assist with navigation.',
  initialKnowledge: [
    {
      id: 'kb_webhooks',
      title: 'Webhooks Guide',
      category: 'Integration',
      content: 'Webhooks can be registered via POST /api/webhooks with HMAC-SHA256 signatures.',
      allowedRoles: ['USER', 'PRO', 'ADMIN']
    }
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_account_status',
        description: 'Retrieves current subscription status and active credits.',
        parameters: { type: 'object', properties: {} }
      }
    }
  ],
  toolHandlers: {
    get_account_status: async (args, req) => {
      return { status: 'ACTIVE', credits: 500 };
    }
  },
  getUserContext: (req) => ({
    userId: req.user?.id || 'anonymous_user',
    userRole: req.user?.role || 'USER'
  })
}));

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

---

## 🌐 Frontend Widget Integration

Include the stylesheet and instantiate the widget in your web application:

```html
<!-- Stylesheet -->
<link rel="stylesheet" href="/node_modules/metaguard-agent/src/widget/metaguard-widget.css">

<!-- Script -->
<script type="module">
  import { MetaGuardWidget } from '/node_modules/metaguard-agent/src/widget/metaguard-widget.js';

  const widget = new MetaGuardWidget({
    apiBase: '/api/agent',
    currentView: 'dashboard'
  });
</script>
```

---

## 🔒 Security Architecture Overview

| Layer | Subsystem | Target Threat | Latency |
| :--- | :--- | :--- | :--- |
| **Layer 1** | Pre-LLM Guardrail | Unicode tags (`U+E0000`), direct jailbreaks, prompt leak extraction | `< 5 ms` (0 tokens) |
| **Layer 2** | Antimalware Magic Bytes | Executables (`MZ`, `ELF`), shebang scripts, embedded PDF exploits | `< 10 ms` |
| **Layer 3** | Prompt Shield Spotlighting | Indirect prompt injection in uploaded files | Dynamic XML delimiters |
| **Layer 4** | Conversational Harness | Brute-force probing, prompt fatigue, abuse | 3 strikes = 30s lockout |
| **Layer 5** | Tool Intent Verification | Unauthorized tool calls triggered via document injection | Verified against user chat |

> 📖 **Deep Dive:** For full architectural specifications, mathematical bounds, and implementation details, see [SECURITY_AND_CUA.md](SECURITY_AND_CUA.md).

---

## 🖥️ Running the Interactive Demo

To test the full conversational experience, security guardrail, and visual Computer Use locally:

1. Clone the repository:
   ```bash
   git clone https://github.com/fenixninja/metaguard-agent.git
   cd metaguard-agent
   ```

2. Install dependencies and compile:
   ```bash
   npm install
   npm run build
   ```

3. Configure your API key:
   ```bash
   cp .env.example .env
   # Add your META_MODEL_API_KEY to .env
   ```

4. Run the interactive demo:
   ```bash
   npm run example
   ```

5. Open your browser at `http://localhost:3000`.

---

## 📄 License

MIT © [Fenix Rios](https://github.com/fenixninja)
