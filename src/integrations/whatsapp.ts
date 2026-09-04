import twilio from 'twilio';
import { env } from '../config/env';

export interface SendWhatsAppParams {
  toPhone: string;
  message: string;
}

export interface SendWhatsAppResult {
  success: boolean;
  messageSid: string;
  isMock: boolean;
  recipient: string;
}

export class WhatsAppService {
  private static twilioClient: twilio.Twilio | null = null;

  // Live Twilio dispatch is disabled for now, not deleted. The trial account
  // hit its billing wall ("upgrade to keep building"), and even past that,
  // this account requires an approved Content Template (ContentSid) for every
  // outbound WhatsApp message (error 21654) regardless of the sandbox's
  // 24-hour session window. Rather than keep fighting trial/template
  // restrictions this close to demo day, sendNudge() below goes straight to
  // the console-simulated dispatch, which shows the same message content,
  // timing, and per-transaction reasoning that actually matters for a judge
  // walkthrough. To re-enable live sending later (after upgrading the account
  // or wiring in a real TWILIO_CONTENT_SID), uncomment getClient() below and
  // the live-dispatch block inside sendNudge().
  //
  // private static getClient(): twilio.Twilio | null {
  //   if (
  //     !this.twilioClient &&
  //     env.TWILIO_ACCOUNT_SID &&
  //     env.TWILIO_AUTH_TOKEN &&
  //     env.TWILIO_ACCOUNT_SID.trim() !== '' &&
  //     env.TWILIO_AUTH_TOKEN.trim() !== ''
  //   ) {
  //     this.twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  //   }
  //   return this.twilioClient;
  // }

  private static formatWhatsAppNumber(phone: string): string {
    let clean = phone.replace(/[^0-9+]/g, '');
    if (!clean.startsWith('+')) {
      // Default to India country code +91 if missing
      clean = clean.length === 10 ? `+91${clean}` : `+${clean}`;
    }
    return clean.startsWith('whatsapp:') ? clean : `whatsapp:${clean}`;
  }

  /**
   * Dispatches WhatsApp message via Twilio or logs formatted message to console fallback.
   */
  public static async sendNudge(params: SendWhatsAppParams): Promise<SendWhatsAppResult> {
    const formattedRecipient = this.formatWhatsAppNumber(params.toPhone);

    // Live dispatch path — disabled, see the comment on getClient() above for
    // why. Uncomment this block (and getClient()) together to re-enable.
    //
    // const client = this.getClient();
    // if (client) {
    //   try {
    //     // Some accounts (this one, per the live 21654 error) require every
    //     // outbound WhatsApp message to reference an approved Content Template
    //     // via ContentSid — freeform `body` text is rejected outright,
    //     // independent of the 24-hour session window. When TWILIO_CONTENT_SID
    //     // is set, send that way; the whole generated message currently rides
    //     // in variable "1" as a placeholder until the real template's variable
    //     // count/order is confirmed from the Twilio Console and this mapping
    //     // is adjusted to match it exactly.
    //     const useContentTemplate = env.TWILIO_CONTENT_SID && env.TWILIO_CONTENT_SID.trim() !== '';
    //     const message = await client.messages.create(
    //       useContentTemplate
    //         ? {
    //             from: env.TWILIO_WHATSAPP_NUMBER,
    //             to: formattedRecipient,
    //             contentSid: env.TWILIO_CONTENT_SID,
    //             contentVariables: JSON.stringify({ '1': params.message })
    //           }
    //         : {
    //             from: env.TWILIO_WHATSAPP_NUMBER,
    //             to: formattedRecipient,
    //             body: params.message
    //           }
    //     );
    //
    //     console.log(`[WhatsAppService] Live message sent via Twilio to ${formattedRecipient} (SID: ${message.sid})`);
    //     return {
    //       success: true,
    //       messageSid: message.sid,
    //       isMock: false,
    //       recipient: formattedRecipient
    //     };
    //   } catch (err: any) {
    //     // Twilio's RestException carries a numeric `code` and a `moreInfo` link
    //     // to the exact error page (e.g. console.twilio.com/.../21654 explains
    //     // precisely why) — err.message alone often isn't enough to tell "wrong
    //     // sandbox window" apart from "wrong number format" apart from "account
    //     // restriction". Logging all of it turns a generic failure into an
    //     // actionable one.
    //     const code = err.code ? ` (code ${err.code})` : '';
    //     const moreInfo = err.moreInfo ? ` — details: ${err.moreInfo}` : '';
    //     console.warn(`[WhatsAppService] Twilio dispatch failed${code}: ${err.message}${moreInfo}. Falling back to console simulation.`);
    //   }
    // }

    // Console simulation fallback
    const mockSid = `SM_mock_${Date.now()}`;
    console.log('====================================================');
    console.log('📱 [WHATSAPP SIMULATED NUDGE DISPATCH]');
    console.log(`To: ${formattedRecipient}`);
    console.log(`From: ${env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886'}`);
    console.log('----------------------------------------------------');
    console.log(params.message);
    console.log('====================================================');

    return {
      success: true,
      messageSid: mockSid,
      isMock: true,
      recipient: formattedRecipient
    };
  }
}
