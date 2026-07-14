// CP-2 (Campaign Management Platform initiative): unit tests for the channel-provider adapters
// extracted from NotificationEngine's former inline deliverViaChannel()/sendSms()/sendEmail()/
// sendWhatsApp()/deliverInApp() — verifies each adapter's request shape and the exact behavior
// (error messages, externalId fallback formats) the original inline code had, so the refactor in
// NotificationEngine.ts is provably a zero-behavior-change extraction.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SmsChannelProvider } from '../domain/channels/SmsChannelProvider.js';
import { EmailChannelProvider } from '../domain/channels/EmailChannelProvider.js';
import { WhatsAppChannelProvider } from '../domain/channels/WhatsAppChannelProvider.js';
import { InAppChannelProvider } from '../domain/channels/InAppChannelProvider.js';
import { ChannelRegistry } from '../domain/channels/ChannelRegistry.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SmsChannelProvider', () => {
  it('calls MSG91 with the 91-prefixed mobile number and template id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ request_id: 'req-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SmsChannelProvider('auth-key', 'tmpl-1');
    const result = await provider.send({ phone: '9876543210', body: 'Hi there', tenantId: 1 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.msg91.com/api/v5/flow/',
      expect.objectContaining({ method: 'POST' })
    );
    const [, options] = fetchMock.mock.calls[0] as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(options.headers['authkey']).toBe('auth-key');
    const body = JSON.parse(options.body);
    expect(body.template_id).toBe('tmpl-1');
    expect(body.recipients[0].mobiles).toBe('919876543210');
    expect(result.externalId).toBe('req-1');
  });

  it('falls back to a sms_<timestamp> id when MSG91 returns no request_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const provider = new SmsChannelProvider('k', 't');
    const result = await provider.send({ phone: '9876543210', body: 'Hi', tenantId: 1 });
    expect(result.externalId).toMatch(/^sms_\d+$/);
  });

  it('throws when no phone number is given', async () => {
    const provider = new SmsChannelProvider('k', 't');
    await expect(provider.send({ body: 'Hi', tenantId: 1 })).rejects.toThrow(
      'SMS requires phone number'
    );
  });

  it('throws a descriptive error on a non-ok MSG91 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, text: async () => 'bad request' })
    );
    const provider = new SmsChannelProvider('k', 't');
    await expect(provider.send({ phone: '9876543210', body: 'Hi', tenantId: 1 })).rejects.toThrow(
      'MSG91 error: bad request'
    );
  });

  it('does not support media', () => {
    expect(new SmsChannelProvider('k', 't').supportsMedia).toBe(false);
  });
});

describe('EmailChannelProvider', () => {
  it('sends plain HTML body when no media is attached', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['X-Message-Id', 'msg-1']]),
    });
    // Map doesn't have a `.get` that matches the Headers interface signature used by the code
    // (response.headers.get(...)) — Map does support .get(), so this is a valid lightweight stand-in.
    vi.stubGlobal('fetch', fetchMock);

    const provider = new EmailChannelProvider('sg-key', 'noreply@erp.local');
    const result = await provider.send({
      email: 'a@b.com',
      subject: 'Hi',
      body: '<p>Hello</p>',
      tenantId: 1,
    });

    const [, options] = fetchMock.mock.calls[0] as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(options.headers['Authorization']).toBe('Bearer sg-key');
    const body = JSON.parse(options.body);
    expect(body.from.email).toBe('noreply@erp.local');
    expect(body.content[0].value).toBe('<p>Hello</p>');
    expect(result.externalId).toBe('msg-1');
  });

  it('appends an inline <img> tag when an image mediaUrl is attached', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Map() });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new EmailChannelProvider('sg-key', 'noreply@erp.local');
    await provider.send({
      email: 'a@b.com',
      body: '<p>Hello</p>',
      tenantId: 1,
      mediaUrl: 'https://example.com/pic.png',
      mediaType: 'image',
    });

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body);
    expect(body.content[0].value).toContain('<img src="https://example.com/pic.png"');
  });

  it('throws when no recipient address is given', async () => {
    const provider = new EmailChannelProvider('k', 'noreply@erp.local');
    await expect(provider.send({ body: 'Hi', tenantId: 1 })).rejects.toThrow(
      'Email requires recipient address'
    );
  });

  it('supports media', () => {
    expect(new EmailChannelProvider('k', 'a@b.com').supportsMedia).toBe(true);
  });
});

describe('WhatsAppChannelProvider', () => {
  it('sends a plain text message when no media is attached', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid-1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new WhatsAppChannelProvider('phone-id-1', 'wa-token');
    const result = await provider.send({ phone: '9876543210', body: 'Hi there', tenantId: 1 });

    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(url).toBe('https://graph.facebook.com/v18.0/phone-id-1/messages');
    expect(options.headers['Authorization']).toBe('Bearer wa-token');
    const body = JSON.parse(options.body);
    expect(body.to).toBe('919876543210');
    expect(body.type).toBe('text');
    expect(body.text.body).toBe('Hi there');
    expect(result.externalId).toBe('wamid-1');
  });

  it('sends an image media message with the body as caption when mediaUrl+mediaType are given', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid-2' }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new WhatsAppChannelProvider('phone-id-1', 'wa-token');
    await provider.send({
      phone: '9876543210',
      body: 'Check this out!',
      tenantId: 1,
      mediaUrl: 'https://example.com/promo.jpg',
      mediaType: 'image',
    });

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body);
    expect(body.type).toBe('image');
    expect(body.image.link).toBe('https://example.com/promo.jpg');
    expect(body.image.caption).toBe('Check this out!');
  });

  it('throws when no phone number is given', async () => {
    const provider = new WhatsAppChannelProvider('p', 't');
    await expect(provider.send({ body: 'Hi', tenantId: 1 })).rejects.toThrow(
      'WhatsApp requires phone number'
    );
  });

  it('supports media', () => {
    expect(new WhatsAppChannelProvider('p', 't').supportsMedia).toBe(true);
  });
});

describe('InAppChannelProvider', () => {
  it('returns an inapp_ prefixed id with no network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new InAppChannelProvider();
    const result = await provider.send({ body: 'Hi', tenantId: 1 });

    expect(result.externalId).toMatch(/^inapp_/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not support media', () => {
    expect(new InAppChannelProvider().supportsMedia).toBe(false);
  });
});

describe('ChannelRegistry', () => {
  const config = {
    msg91AuthKey: 'k',
    msg91TemplateId: 't',
    sendgridApiKey: 'sg',
    fromEmail: 'a@b.com',
    whatsappPhoneNumberId: 'p',
    whatsappAccessToken: 'tok',
  };

  it('resolves every channel to its matching provider instance', () => {
    const registry = new ChannelRegistry(config);
    expect(registry.get('SMS')).toBeInstanceOf(SmsChannelProvider);
    expect(registry.get('EMAIL')).toBeInstanceOf(EmailChannelProvider);
    expect(registry.get('WHATSAPP')).toBeInstanceOf(WhatsAppChannelProvider);
    expect(registry.get('IN_APP')).toBeInstanceOf(InAppChannelProvider);
  });
});
