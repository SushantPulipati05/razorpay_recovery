import Razorpay from 'razorpay';
import { env } from '../config/env';

export interface CreatePaymentLinkParams {
  orderId: string;
  originalAmount: number;
  discountedAmount: number;
  customerPhone: string;
  customerEmail?: string | null;
  description?: string;
  recoveryTxId: string;
  /** Restrict checkout methods. Bank-outage recovery uses UPI only. */
  methods?: { upi?: boolean; card?: boolean; netbanking?: boolean; wallet?: boolean };
}

export interface PaymentLinkResult {
  paymentLinkId: string;
  shortUrl: string;
  amount: number;
  isMock: boolean;
}

/**
 * The razorpay SDK doesn't always throw plain Error objects — API rejections
 * usually come back as { statusCode, error: { code, description, ... } },
 * which leaves err.message undefined and swallows the real reason. This pulls
 * out whatever's actually there instead of logging "undefined".
 */
function describeRazorpayError(err: any): string {
  if (!err) return 'Unknown error';
  const nested = err.error?.description || err.error?.code;
  if (nested) return `${nested}${err.statusCode ? ` (HTTP ${err.statusCode})` : ''}`;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export class RazorpayLinkService {
  private static razorpayInstance: Razorpay | null = null;

  private static getInstance(): Razorpay | null {
    if (
      !this.razorpayInstance &&
      env.RAZORPAY_KEY_ID &&
      env.RAZORPAY_KEY_SECRET &&
      !env.RAZORPAY_KEY_ID.includes('placeholder')
    ) {
      this.razorpayInstance = new Razorpay({
        key_id: env.RAZORPAY_KEY_ID,
        key_secret: env.RAZORPAY_KEY_SECRET
      });
    }
    return this.razorpayInstance;
  }

  public static async createDiscountedLink(params: CreatePaymentLinkParams): Promise<PaymentLinkResult> {
    const rzp = this.getInstance();
    const amountInPaise = Math.round(params.discountedAmount * 100);
    const method = params.methods || { upi: true, card: true, netbanking: true, wallet: true };

    if (rzp) {
      try {
        const link = await rzp.paymentLink.create({
          amount: amountInPaise,
          currency: 'INR',
          accept_partial: false,
          description: params.description || `Recovery payment for Order #${params.orderId}`,
          customer: {
            contact: params.customerPhone,
            email: params.customerEmail || undefined
          },
          notify: {
            sms: false,
            email: false
          },
          reminder_enable: false,
          notes: {
            original_amount: params.originalAmount.toString(),
            discounted_amount: params.discountedAmount.toString(),
            original_order_id: params.orderId,
            recovery_tx_id: params.recoveryTxId,
            recovery_service: 'razorpay-recover'
          },
          options: {
            checkout: {
              method: {
                upi: method.upi === false ? 0 : 1,
                card: method.card === false ? 0 : 1,
                netbanking: method.netbanking === false ? 0 : 1,
                wallet: method.wallet === false ? 0 : 1
              }
            }
          }
        } as any);

        return {
          paymentLinkId: link.id,
          shortUrl: link.short_url,
          amount: params.discountedAmount,
          isMock: false
        };
      } catch (err: any) {
        console.warn(`[RazorpayLinkService] Live link creation failed: ${describeRazorpayError(err)}. Using fallback mock link.`);
      }
    }

    const mockId = `plink_mock_${params.recoveryTxId.replace(/-/g, '').slice(0, 10)}_${Date.now()}`;
    return {
      paymentLinkId: mockId,
      shortUrl: `https://rzp.io/i/recov_${mockId.slice(-8)}`,
      amount: params.discountedAmount,
      isMock: true
    };
  }
}
