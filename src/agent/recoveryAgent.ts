import Groq from 'groq-sdk';
import { env } from '../config/env';
import { DiagnosedStrategy, FailureCategory, LossMode } from '../types/db';

export interface RecoveryCopyParams {
  customerPhone: string;
  originalAmount: number;
  discountedAmount: number;
  discountPercent: number;
  failureCategory: FailureCategory;
  failureReason: string;
  paymentLink: string;
  orderId: string;
  strategy: DiagnosedStrategy;
  lossMode: LossMode | string;
  preferredMethod?: string | null;
}

export class RecoveryAgent {
  private static groqClient: Groq | null = null;

  private static getGroq(): Groq | null {
    if (!this.groqClient && env.GROQ_API_KEY && env.GROQ_API_KEY.trim() !== '') {
      this.groqClient = new Groq({
        apiKey: env.GROQ_API_KEY
      });
    }
    return this.groqClient;
  }

  public static async generateCopy(params: RecoveryCopyParams): Promise<{ message: string; source: 'groq' | 'fallback'; tokensUsed?: number }> {
    const groq = this.getGroq();

    if (groq) {
      try {
        const prompt = this.buildPrompt(params);
        const response = await groq.chat.completions.create({
          // Same reasoning as diagnosticClassifier.ts: llama-3.3-70b-versatile
          // is enterprise-only pricing now, so gpt-oss-20b is the current
          // developer-tier-accessible plain chat model with a generous rate
          // limit and no inherited sub-model rate limits.
          //
          // gpt-oss is a reasoning model — its internal reasoning tokens count
          // against max_tokens, so max_tokens: 200 could leave zero budget for
          // the actual message (silently falling back to canned copy with no
          // error logged). reasoning_effort: 'low' keeps reasoning minimal for
          // a copywriting task this simple, and a higher max_tokens leaves
          // real headroom for the ~70-word message itself.
          model: 'openai/gpt-oss-20b',
          messages: [
            { role: 'system', content: 'You create polite, concise payment recovery messages for WhatsApp in India. Keep under 70 words. No markdown headers. Plain conversational text only. Never mention fraud. Never promise items are reserved unless this is a checkout drop-off.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.5,
          max_tokens: 400,
          reasoning_effort: 'low'
        });

        const copy = response.choices[0]?.message?.content?.trim();
        if (copy) {
          return {
            message: copy,
            source: 'groq',
            tokensUsed: response.usage?.total_tokens
          };
        }
      } catch (err: any) {
        console.warn(`[RecoveryAgent] Groq call failed: ${err.message}. Falling back to default recovery copy.`);
      }
    }

    return {
      message: this.getFallbackCopy(params),
      source: 'fallback'
    };
  }

  private static buildPrompt(params: RecoveryCopyParams): string {
    const rail = params.preferredMethod === 'upi' ? 'UPI only (issuer card rails were down)' : 'UPI, cards, or netbanking';
    const offer = params.discountPercent > 0
      ? `${params.discountPercent}% goodwill discount. Pay ₹${params.discountedAmount}.`
      : 'No discount. Same amount.';
    return `Write a WhatsApp recovery message.
Loss mode: ${params.lossMode}
Strategy: ${params.strategy}
Order: ${params.orderId}
Amount: ₹${params.originalAmount}
Failure: ${params.failureReason}
Offer: ${offer}
Checkout methods: ${rail}
Link: ${params.paymentLink}
Rules:
- Insufficient funds: do NOT say items are reserved. Ask them to retry when funds are available.
- Bank outage: reassure auto-refund in 2-3 days if debited; point to UPI.
- Subscription: this is a membership renewal, not a cart.
- Invoice overdue: professional B2B receivables tone, no discount language.
- Checkout drop: brief goodwill tone is OK.`;
  }

  private static getFallbackCopy(params: RecoveryCopyParams): string {
    const link = params.paymentLink;
    const order = params.orderId;
    const amt = params.originalAmount;

    if (params.lossMode === 'INVOICE_OVERDUE') {
      return `Hello, invoice ${order} for ₹${amt} is overdue. Please complete payment at ${link}. Reply if you need a GST invoice copy or a revised due date.`;
    }

    if (params.lossMode === 'SUBSCRIPTION_FAILED') {
      return `Hi, your membership payment of ₹${amt} (${order}) did not go through. Retry here so your plan stays active: ${link}`;
    }

    if (params.strategy === 'INSUFFICIENT_FUNDS_DEFERRED') {
      return `Hi, your payment of ₹${amt} for ${order} could not be completed due to insufficient funds. When you have balance, you can pay the same amount here: ${link}`;
    }

    if (params.strategy === 'BANK_OUTAGE_ALTERNATIVE_RAIL') {
      return `Hi, your bank could not authorise ₹${amt} for ${order}. If money was debited, it should reverse in 2-3 days. Complete the order on UPI here: ${link}`;
    }

    const discountText = params.discountPercent > 0
      ? ` We've applied a ${params.discountPercent}% goodwill discount (pay ₹${params.discountedAmount}).`
      : '';
    return `Hi, your payment of ₹${amt} for order ${order} was interrupted.${discountText} Complete it here: ${link}`;
  }
}
