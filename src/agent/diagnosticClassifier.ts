import Groq from 'groq-sdk';
import { DiagnosticResult, DiagnosedStrategy, FailureCategory } from '../types/db';
import { env } from '../config/env';
import { mergeDiagnoses } from './conservativeMerge';

export interface ClassifyInput {
  errorCode: string;
  errorDescription?: string;
  errorSource?: string;
  errorStep?: string;
}

/**
 * Always runs deterministic rules. Groq is consulted when a key is present
 * (skipped in unit tests). Disagreement is merged conservatively — fraud and
 * NSF beat a 5% discount hallucination.
 */
export class DiagnosticClassifier {
  private static groqClient: Groq | null = null;

  private static getGroq(): Groq | null {
    if (env.NODE_ENV === 'test') return null;
    if (!this.groqClient && env.GROQ_API_KEY && env.GROQ_API_KEY.trim() !== '') {
      this.groqClient = new Groq({ apiKey: env.GROQ_API_KEY });
    }
    return this.groqClient;
  }

  public static async classify(input: ClassifyInput): Promise<DiagnosticResult> {
    const rules = DiagnosticClassifier.ruleBasedClassify(input);
    const groq = this.getGroq();

    if (!groq) {
      return mergeDiagnoses(rules, null);
    }

    try {
      const prompt = `You are an expert payment failure analyst for a Razorpay-powered Indian e-commerce platform.
Analyze the following payment failure and return ONLY a valid JSON object — no markdown, no explanation.

Error Code: ${input.errorCode || 'UNKNOWN'}
Error Description: ${input.errorDescription || 'Not provided'}
Error Source: ${input.errorSource || 'unknown'}
Error Step: ${input.errorStep || 'unknown'}

Respond with ONLY this JSON structure:
{
  "category": "BANK_NETWORK_ERROR" | "CUSTOMER_ERROR",
  "strategy": "BANK_OUTAGE_ALTERNATIVE_RAIL" | "CUSTOMER_DROP_INCENTIVE_5_PERCENT" | "INSUFFICIENT_FUNDS_DEFERRED" | "FRAUD_DECLINE_NO_RETRY",
  "recommendedDiscountPercent": 0 | 5,
  "explanation": "one concise sentence"
}

Classification rules:
- BANK_NETWORK_ERROR (strategy: BANK_OUTAGE_ALTERNATIVE_RAIL, discount: 0): bank timeouts, gateway errors, issuer unavailable, network issues, server errors
- CUSTOMER_ERROR + CUSTOMER_DROP_INCENTIVE_5_PERCENT (discount: 5): user cancelled, OTP failure, authentication drop, general decline
- CUSTOMER_ERROR + INSUFFICIENT_FUNDS_DEFERRED (discount: 0): insufficient balance, credit limit exceeded — discount won't help
- CUSTOMER_ERROR + FRAUD_DECLINE_NO_RETRY (discount: 0): fraud flag, suspicious activity — do not retry`;

      const response = await groq.chat.completions.create({
        // llama-3.3-70b-versatile moved to enterprise-only pricing (Aug 2026),
        // so free/dev-tier keys now get 404 model_not_found on it. gpt-oss-20b
        // is Groq's current developer-tier-accessible plain chat model — fast,
        // cheap, no agentic tool-routing, and a generous rate limit (250K TPM /
        // 1K RPM) versus compound-mini's 250 requests/day cap.
        //
        // gpt-oss is a reasoning model: it spends tokens on internal reasoning
        // before writing the final answer, and those reasoning tokens count
        // against max_tokens. At max_tokens: 150 the reasoning alone was
        // eating the whole budget, truncating the JSON mid-string (hence the
        // "Unterminated string in JSON" parse errors). reasoning_effort: 'low'
        // keeps reasoning minimal for this simple classification task, a
        // higher max_tokens leaves headroom even so, and response_format
        // forces valid JSON instead of relying on the model to follow the
        // "no markdown" instruction in the prompt.
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 500,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' }
      });

      const raw = response.choices[0]?.message?.content?.trim();
      if (raw) {
        const jsonStr = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        if (parsed.category && parsed.strategy) {
          const ai: DiagnosticResult = {
            category: parsed.category as FailureCategory,
            strategy: parsed.strategy as DiagnosedStrategy,
            recommendedDiscountPercent: Number(parsed.recommendedDiscountPercent ?? 0),
            explanation: parsed.explanation || 'AI-classified failure.',
            source: 'groq'
          };

          // Judge-facing visibility: print Groq's own reasoning for this call,
          // and whether the rule-based engine agreed or is about to overrule it
          // (mergeDiagnoses decides that next — this just shows both inputs
          // going into that decision).
          const agreement = rules.strategy === ai.strategy ? 'agrees with' : 'DISAGREES with';
          console.log(
            `[DiagnosticClassifier] Groq reasoning: "${ai.explanation}" → ${ai.category}/${ai.strategy}` +
            ` (${agreement} rule-based strategy ${rules.strategy})`
          );

          return mergeDiagnoses(rules, ai);
        }
      }
    } catch (err: any) {
      console.warn(`[DiagnosticClassifier] Groq AI failed: ${err.message}. Using rule-based fallback.`);
    }

    return mergeDiagnoses(rules, null);
  }

  public static ruleBasedClassify(input: ClassifyInput): DiagnosticResult {
    const code = (input.errorCode || '').toUpperCase();
    const desc = (input.errorDescription || '').toLowerCase();
    const source = (input.errorSource || '').toLowerCase();

    const isBankNetwork =
      source === 'bank' ||
      source === 'gateway' ||
      code.includes('GATEWAY') ||
      code.includes('SERVER') ||
      code.includes('ISSUER_DOWN') ||
      code.includes('NETWORK') ||
      code.includes('TIMEOUT') ||
      desc.includes('bank technical error') ||
      desc.includes('issuer is down') ||
      desc.includes('network error') ||
      desc.includes('timed out');

    if (isBankNetwork) {
      return {
        category: 'BANK_NETWORK_ERROR',
        strategy: 'BANK_OUTAGE_ALTERNATIVE_RAIL',
        recommendedDiscountPercent: 0,
        explanation: `Bank/Network failure detected (${input.errorCode}). Reassure customer and provide alternate payment link.`,
        source: 'rules'
      };
    }

    const isInsufficientFunds =
      code.includes('INSUFFICIENT') ||
      code.includes('LIMIT') ||
      desc.includes('insufficient') ||
      desc.includes('limit exceeded');

    if (isInsufficientFunds) {
      return {
        category: 'CUSTOMER_ERROR',
        strategy: 'INSUFFICIENT_FUNDS_DEFERRED',
        recommendedDiscountPercent: 0,
        explanation: `Insufficient funds or limit exceeded (${input.errorCode}). No discount — customer needs to arrange funds.`,
        source: 'rules'
      };
    }

    const isFraud =
      code.includes('FRAUD') ||
      code.includes('SUSPICIOUS') ||
      desc.includes('fraud') ||
      desc.includes('suspicious');

    if (isFraud) {
      return {
        category: 'CUSTOMER_ERROR',
        strategy: 'FRAUD_DECLINE_NO_RETRY',
        recommendedDiscountPercent: 0,
        explanation: `Fraud flag detected (${input.errorCode}). Halting recovery to avoid compliance risk.`,
        source: 'rules'
      };
    }

    return {
      category: 'CUSTOMER_ERROR',
      strategy: 'CUSTOMER_DROP_INCENTIVE_5_PERCENT',
      recommendedDiscountPercent: 5.0,
      explanation: `Customer drop-off or authentication failure (${input.errorCode || 'UNKNOWN'}). Recommend recovery nudge with 5% discount.`,
      source: 'rules'
    };
  }
}
