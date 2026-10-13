/**
 * VARDHAN Outreach Command Center - Local Ollama LLM Service v3
 * Communicates directly with local Ollama API on http://localhost:11434
 * Always includes specific target research report URL: https://www.vardhantechlabs.com/research/[companySlug]
 */

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

export const OLLAMA_DEFAULT_URL = 'http://localhost:11434';

export const RECOMMENDED_MODELS = [
  { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B (Ultra-Concise Copy)', command: 'ollama pull qwen2.5:7b' },
  { id: 'deepseek-coder:6.7b', name: 'DeepSeek Coder 6.7B (Deep Technical Reasoning)', command: 'ollama pull deepseek-coder:6.7b' },
  { id: 'llama3:8b', name: 'Llama 3 8B (Executive Phrasing)', command: 'ollama pull llama3:8b' },
  { id: 'mistral:7b', name: 'Mistral 7B (Fast Reasoning)', command: 'ollama pull mistral' }
];

/**
 * Checks if local Ollama server is running on http://localhost:11434
 */
export async function checkOllamaHealth(baseUrl = OLLAMA_DEFAULT_URL): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetches available local models installed in Ollama
 */
export async function getOllamaModels(baseUrl = OLLAMA_DEFAULT_URL): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { method: 'GET' });
    if (!res.ok) return RECOMMENDED_MODELS.map(m => m.id);
    const data = await res.json();
    return data.models && data.models.length > 0 ? data.models.map((m: any) => m.name) : RECOMMENDED_MODELS.map(m => m.id);
  } catch {
    return RECOMMENDED_MODELS.map(m => m.id);
  }
}

/**
 * Generates an extraordinary, hyper-personalized top industry-level email using Ollama
 */
export async function generateExtraordinaryEmailWithOllama(params: {
  companySlug: string;
  companyName: string;
  contactName: string;
  designation: string;
  techStack: string;
  challenge: string;
  stageName?: string;
  ctaType?: 'video' | 'pdf' | 'meeting';
  model?: string;
  baseUrl?: string;
}): Promise<{ subject: string; body: string }> {
  const {
    companySlug,
    companyName,
    contactName,
    designation,
    techStack,
    challenge,
    stageName = 'Stage 1: Superhuman Call-Out',
    ctaType = 'video',
    model = 'llama3',
    baseUrl = OLLAMA_DEFAULT_URL
  } = params;

  const firstName = contactName.split(' ')[0];
  const reportUrl = `https://www.vardhantechlabs.com/research/${companySlug.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

  const ctaLine = ctaType === 'video'
    ? 'Happy to record a 3-minute screen trace walking through the lock contention pattern if helpful.'
    : ctaType === 'pdf'
    ? 'Mind if I send over the 2-page topology blueprint for your platform lead?'
    : 'Available for a 15-minute peer alignment call if your team is refactoring this layer.';

  const systemPrompt = `You are Vishnu Vardhan Burri, Director & Principal Architect at VARDHAN Technologies.
You engage CTOs and VPs of Engineering at high-growth Series A+ tech companies (Linear, Supabase, Wiz, Stripe, Datadog) to close £75,000 GBP engagements.

STRICT WRITING RULES:
1. Total length MUST be under 55 words.
2. Direct, zero marketing fluff, zero AI phrasing (NEVER use "I hope this email finds you well", "transformative", "game-changer").
3. Speak as a peer Principal Architect referencing actual low-level infrastructure bottlenecks (P99 latencies, eBPF telemetry, connection lock contention, thread starvation).
4. MUST include specific research report URL: ${reportUrl}
5. End with CTA: "${ctaLine}"`;

  const userPrompt = `Generate a Top Industry-Level ${stageName} email for:
- Company: ${companyName}
- Executive: ${firstName} (${designation})
- Tech Stack: ${techStack}
- Architecture Challenge: ${challenge}
- Company Specific Research Link: ${reportUrl}

Return format strictly as JSON:
{
  "subject": "exact high-converting subject line",
  "body": "exact email body text including research URL: ${reportUrl}"
}`;

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama returned status ${response.status}`);
    }

    const data: OllamaGenerateResponse = await response.json();
    const rawText = data.response;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.subject && parsed.body) {
        let bodyText = parsed.body.trim();

        // Ensure research report URL is explicitly present
        if (!bodyText.includes(reportUrl)) {
          bodyText = bodyText.replace(/https:\/\/www\.vardhantechlabs\.com\/?/g, reportUrl);
          if (!bodyText.includes(reportUrl)) {
            bodyText += `\n\nMapped architecture report: ${reportUrl}`;
          }
        }

        return {
          subject: parsed.subject.trim(),
          body: bodyText
        };
      }
    }

    return {
      subject: `Engineering Intelligence Recon: ${companyName} (${challenge.slice(0, 30)}...)`,
      body: `Hi ${firstName} —\n\nWe noticed an architectural mention regarding ${challenge} at ${companyName}. We can't determine the internal implementation from public information, but it raises an interesting question around managing this layer.\n\nMapped research report: ${reportUrl}\n\n${ctaLine}\n\n— Vishnu`
    };
  } catch (err) {
    console.warn('Ollama API fallback triggered.', err);

    return {
      subject: `Architecture question re: ${challenge.split(' ')[0]}`,
      body: `Hi ${firstName} —\n\nWe noticed ${challenge} in recent public references. We can't determine the internal implementation from public information, but it raises an interesting question around your team's approach to this.\n\nMapped research report: ${reportUrl}\n\n${ctaLine}\n\n— Vishnu`
    };
  }
}

/**
 * Generates authoritative, zero-sales objection handling copy using Ollama
 */
export async function generateObjectionHandlingWithOllama(params: {
  companySlug: string;
  companyName: string;
  contactName: string;
  objectionType: string;
  challenge: string;
  model?: string;
  baseUrl?: string;
}): Promise<{ subject: string; body: string }> {
  const {
    companySlug,
    companyName,
    contactName,
    objectionType,
    challenge,
    model = 'llama3',
    baseUrl = OLLAMA_DEFAULT_URL
  } = params;

  const firstName = contactName.split(' ')[0];
  const reportUrl = `https://www.vardhantechlabs.com/research/${companySlug.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

  const systemPrompt = `You are Vishnu Vardhan Burri, Director & Principal Architect at VARDHAN Technologies.
You are replying to an objection from a CTO or VP of Engineering at a Series A+ tech company.

STRICT WRITING RULES:
1. Total length MUST be under 60 words.
2. Direct, zero marketing fluff, highly authoritative peer-to-peer tone.
3. NEVER argue. Instead, reframe the objection around technical debt and P99 SLA degradation.
4. MUST include a reference to their specific architectural bottleneck: "${challenge}"
5. MUST include specific research report URL: ${reportUrl}
6. End with a low-friction question: "Worth 15 mins to compare notes?"`;

  const userPrompt = `Generate an Objection Handling reply for:
- Company: ${companyName}
- Executive: ${firstName}
- The Objection They Gave: "${objectionType}"
- Architecture Challenge: ${challenge}
- Company Specific Research Link: ${reportUrl}

Return format strictly as JSON:
{
  "subject": "Re: your last email (keep it conversational)",
  "body": "exact email body text including research URL: ${reportUrl}"
}`;

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama returned status ${response.status}`);
    }

    const data: OllamaGenerateResponse = await response.json();
    const rawText = data.response;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.subject && parsed.body) {
        let bodyText = parsed.body.trim();
        if (!bodyText.includes(reportUrl)) {
           bodyText += `\n\nReference report: ${reportUrl}`;
        }
        return {
          subject: parsed.subject.trim(),
          body: bodyText
        };
      }
    }

    throw new Error("Failed to parse JSON from Ollama");
  } catch (err) {
    console.warn('Ollama objection handling fallback triggered.', err);

    // High-converting fallback copy - strictly stripped of synthetic claims
    let bodyText = `Hi ${firstName} — entirely understood.\n\nThe reason I reached out isn't to replace your team, but because we noted public discussion regarding ${challenge}. Most teams delay architecture audits until scaling forces a rewrite.\n\nHere is the mapped topology report: ${reportUrl}\n\nWorth 15 mins to compare notes?`;

    return {
      subject: `Re: Engineering Peer Note`,
      body: bodyText
    };
  }
}

