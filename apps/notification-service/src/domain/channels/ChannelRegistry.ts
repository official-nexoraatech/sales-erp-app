import type { NotificationServiceConfig } from '../../config.js';
import { SmsChannelProvider } from './SmsChannelProvider.js';
import { EmailChannelProvider } from './EmailChannelProvider.js';
import { WhatsAppChannelProvider } from './WhatsAppChannelProvider.js';
import { InAppChannelProvider } from './InAppChannelProvider.js';
import type { ChannelName, ChannelProvider } from './types.js';

export class ChannelRegistry {
  private readonly providers: Map<ChannelName, ChannelProvider>;

  constructor(
    config: Pick<
      NotificationServiceConfig,
      | 'msg91AuthKey'
      | 'msg91TemplateId'
      | 'sendgridApiKey'
      | 'fromEmail'
      | 'whatsappPhoneNumberId'
      | 'whatsappAccessToken'
    >
  ) {
    this.providers = new Map<ChannelName, ChannelProvider>([
      ['SMS', new SmsChannelProvider(config.msg91AuthKey, config.msg91TemplateId)],
      ['EMAIL', new EmailChannelProvider(config.sendgridApiKey, config.fromEmail)],
      [
        'WHATSAPP',
        new WhatsAppChannelProvider(config.whatsappPhoneNumberId, config.whatsappAccessToken),
      ],
      ['IN_APP', new InAppChannelProvider()],
    ]);
  }

  get(channel: ChannelName): ChannelProvider {
    const provider = this.providers.get(channel);
    if (!provider) throw new Error(`No channel provider registered for ${channel}`);
    return provider;
  }
}

export type {
  ChannelName,
  ChannelProvider,
  ChannelDeliveryParams,
  ChannelDeliveryResult,
} from './types.js';
