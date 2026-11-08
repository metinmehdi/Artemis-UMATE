// GET /api/qr?text=: the QR code (SVG) for the phone link shown on the panel.
import QRCode from 'qrcode';

export default async function handler(req, res) {
  const text = String(new URL(req.url, 'http://x').searchParams.get('text') || '').slice(0, 500);
  const svg = await QRCode.toString(text, { type: 'svg', margin: 2, width: 220, color: { dark: '#230d37', light: '#fffdf6' } });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  res.end(svg);
}
