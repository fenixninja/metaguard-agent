# MetaGuard Architecture: Security Guardrail, Conversational Harness & Computer Use (CUA)

This document provides a technical specification of the security engines, conversational protection harness, and Computer Use (CUA) visual navigation pipelines implemented in `metaguard-agent`.

---

## 1. Security Architecture & Threat Model

`metaguard-agent` protects conversational AI systems from adversarial manipulation, resource exhaustion, and remote code execution through a defense-in-depth model across three execution phases:

```
[ Incoming Request ]
        │
        ├──▶ Phase 1: Pre-LLM Guardrail (< 5ms)
        │      ├── Unicode Tag & BiDi Smuggling Detector
        │      ├── Direct Jailbreak & Prompt Extractor Classifier
        │      ├── Zero-Code Policy Enforcer (CODE_REQUEST)
        │      └── Out-of-Domain Filter (OFF_TOPIC)
        │
        ├──▶ Phase 2: Antimalware & Attachment Shield
        │      ├── Binary Magic Bytes Validation (PDF, Images, Audio)
        │      ├── Executable Binary Blocker (MZ, ELF, Shebang #!)
        │      ├── Embedded Script / Exploit Scanner (/JS, eval, <script>)
        │      └── Level 2 Dynamic Spotlight Delimiters (<untrusted_file_data_${id}>)
        │
        ├──▶ Phase 3: Meta Model API Inference (muse-spark-1.3)
        │      └── Dynamic RAG & Role-Filtered Knowledge Base
        │
        ├──▶ Phase 4: Intent Verification on Tool Calls
        │      └── Validates whether tool arguments were explicitly requested by the user prompt
        │
        └──▶ Phase 5: Post-LLM Zero-Code Scrubber
               └── Enforces zero-code policy on model responses
```

---

## 2. Conversational Harness & Rate Limiter

The Conversational Harness prevents prompt fatigue, automated probing, and brute-force jailbreak iterations using an adaptive state machine:

### 2.1 The 3-Strike Lockout Policy
1. **Strike Accounting:**
   - Every security infraction (off-topic spam, prompt injection, malware attachment) increments the user's strike counter.
   - Low/Medium infractions add `+1 strike`.
   - Critical infractions (executable payload, direct zero-day attempt) immediately set strikes to `MAX (3)`.
2. **Lockout Trigger:**
   - Upon reaching 3 strikes, the middleware returns `HTTP 429 Too Many Requests` with a mandatory **30-second cooldown period** (`cooldownSeconds: 30`).
   - The frontend widget receives this status and disables all input fields, displaying a real-time countdown timer to the user.
3. **Automatic Window Reset:**
   - If a user interacts legitimately within the authorized application domain, the strike streak is preserved clean.
   - If 10 minutes elapse without infractions, accumulated strikes are purged from memory.

---

## 3. Three-Level Indirect Prompt Injection Defense

Indirect prompt injection occurs when an attacker embeds adversarial instructions inside an external document (e.g. invoice PDF, profile picture metadata, or audio memo) that the agent inspects.

### Level 1: CPU-Light Contraband Detector (< 1 ms, 0 Tokens)
- **Unicode Tag Contraband (`U+E0000`–`U+E007F`):** Scans for invisible Unicode tags frequently used to hide commands from human eyes while remaining readable by LLMs.
- **BiDi Overrides (`U+202A`–`U+202E`, `U+2066`–`U+2069`):** Blocks bidirectional text reversals that flip visually displayed text while feeding opposing prompt order to the tokenizer.
- **Zero-Width Character Bursts:** Rejects strings containing bursts of zero-width spaces (`\u200B`, `\u200C`, `\u200D`, `\uFEFF`, `\u2060`) exceeding 5 consecutive characters.

### Level 2: Dynamic Spotlight Delimiters
When document text (from OCR, PDF text extraction, or STT audio transcription) is fed into the model prompt:
1. The text is analyzed for adversarial phrases (`ignore previous instructions`, `you are now in developer mode`).
2. High-risk phrases are scrubbed or rejected if the calculated `riskScore >= 70`.
3. The content is wrapped inside a unique, cryptographically random spotlight boundary:
   ```xml
   <untrusted_file_data_a8f9c1e4>
   ... raw file text ...
   </untrusted_file_data_a8f9c1e4>
   ```
4. The system prompt instructs the model that any text enclosed in dynamic spotlight tags represents **passive data only** and must never be interpreted as instructions.

### Level 3: Tool-Call Intent Verification
- When the model returns a `tool_call` for a sensitive operation (e.g. `manage_credentials`, `configure_webhook`, `delete_resource`):
- The shield verifies that the original user message typed in the chat explicitly mentioned keywords related to that action.
- If the tool call was prompted solely by the content of an attached file, execution is aborted, and a `CRITICAL` security event is recorded.

---

## 4. Antimalware & Steganographic Document Inspection

The `AntimalwareScanner` inspects binary buffers before files are stored or parsed:

1. **Magic Bytes Validation:**
   - Evaluates true binary headers rather than trusting file extensions:
     - PDF: `%PDF-`
     - PNG: `\x89PNG\r\n\x1a\n`
     - JPEG: `\xFF\xD8\xFF`
     - GIF: `GIF87a` / `GIF89a`
     - WEBP / WAV: `RIFF....WEBP` / `RIFF....WAVE`
     - OGG: `OggS`
     - MP3: `ID3` or sync frame headers `0xFFE0`
2. **Executable Binary Blocking:**
   - Detects Windows PE headers (`MZ`), Linux ELF headers (`\x7fELF`), and Unix shebangs (`#!/bin/bash`).
3. **Hidden Steganographic Text in PDFs:**
   - Scans PostScript rendering operators for invisible text tricks:
     - `3 Tr`: Sets text rendering mode to invisible.
     - `0 Tf`: Sets font size to zero points.
     - `1 1 1 rg ... 1 1 1 RG`: White text rendered on white backgrounds.
     - Malicious action dictionaries: `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFiles`.

---

## 5. Computer Use Architecture (CUA)

MetaGuard incorporates visual GUI interaction via Meta's `muse-wonder-1.0` model:

```
[ Frontend Client ]                               [ Meta Model API ]
         │                                                │
 1. Capture Viewport (Canvas JPEG, q=0.65)                │
         │                                                │
 2. POST /api/agent/computer-use ────────────────────────▶│
                                                3. muse-wonder-1.0
                                                   Inspects screen coordinates
                                                   Generates action: { type, x, y }
         │                                                │
 4. Receive Action { type: 'click', x: 240, y: 180 } ◀────┘
         │
 5. Frontend Visual Execution:
    - Target element highlighted with .mg-spotlight-ring
    - Smooth scrollIntoView({ behavior: 'smooth' })
    - Click ripple animation (.mg-click-ripple)
```

### 5.1 DOM-First Fast Path vs. Vision Tokens
- **DOM Fast Path (0 Tokens):** Direct user requests targeting known internal application routes or element IDs are resolved via DOM dispatch without invoking visual vision models.
- **Vision Inference (muse-wonder-1.0):** When visual exploration or unmapped UI layouts are involved, the viewport is rasterized into a lightweight compressed JPEG (`quality: 0.65`) and sent to `/v1/responses` with native `tools: [{"type": "computer"}]`.

### 5.2 Visual Feedback State Machine
- **Spotlight Focus:** Target interactive elements receive an animated green focus ring (`outline: 3px solid #10b981`, `box-shadow: 0 0 20px rgba(16, 185, 129, 0.45)`).
- **Click Ripple:** Synthesizes a tactile radial expansion animation at the exact pixel coordinates `(x, y)` returned by the model.
- **Virtual Cursor:** Supports dual-mode cursor switching between `pointing` (target focus) and `idle/assist` (unobtrusive hovering).
