import { useState, useEffect } from 'react';
import QRCode from 'qrcode';

export function UpiQr({ vpa, payeeName, amount }: { vpa: string; payeeName: string; amount: number }) {
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => {
    const uri = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payeeName)}&am=${amount.toFixed(2)}&cu=INR`;
    void QRCode.toDataURL(uri, { width: 160, margin: 1 }).then(setDataUrl);
  }, [vpa, payeeName, amount]);
  if (!dataUrl) return null;
  return <img src={dataUrl} alt="UPI QR" className="mx-auto rounded-lg shadow-token-sm" />;
}
