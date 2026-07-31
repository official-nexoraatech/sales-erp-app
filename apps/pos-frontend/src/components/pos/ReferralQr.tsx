import { useState, useEffect } from 'react';
import QRCode from 'qrcode';

// CRM-ROADMAP Phase 2, Feature 4 — "Refer a friend" QR on the POS receipt, encoding the tracked
// GET /r/:code redirect (not the /refer/:code landing page directly), so a scan-and-share still
// records a CLICKED event, same reasoning as CustomerViewPage.tsx's own referral link.
export function ReferralQr({ referralLink }: { referralLink: string }) {
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(referralLink, { width: 160, margin: 1 }).then(setDataUrl);
  }, [referralLink]);
  if (!dataUrl) return null;
  return (
    <img src={dataUrl} alt="Refer a friend QR" className="mx-auto rounded-lg shadow-token-sm" />
  );
}
