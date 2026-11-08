// UMATE brand colours and fonts for code that draws on canvas (3D panels, charts).
// Same values as client/assets/brand.css; see that file for the contrast rules.
export const BRAND = {
  ivory: '#faf6e9',
  ivorySoft: 'rgba(250,246,233,0.72)',
  ivoryFaint: 'rgba(250,246,233,0.25)',
  ink: '#230d37',
  inkLift: '#3a1f55',
  glass: 'rgba(35,13,55,0.88)',
  glassEdge: 'rgba(250,246,233,0.2)',
  mint: '#7ee0c3',
  mintGlow: 'rgba(126,224,195,0.35)',
  amber: '#f2b33d',
  violet: '#7a4fb0',
};

export const FONT_UI = '"Lexend", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const FONT_DISPLAY = '"Fraunces Soft", Georgia, serif';

// Wait for the brand fonts before drawing canvas text (Azerbaijani letters included).
export async function loadBrandFonts() {
  if (!document.fonts) return;
  const sample = 'Əə Ğğ İı Şş Çç Öö Üü';
  await Promise.allSettled([
    document.fonts.load(`700 64px ${FONT_UI}`, sample),
    document.fonts.load(`600 64px ${FONT_UI}`, sample),
    document.fonts.load(`400 64px ${FONT_UI}`, sample),
    document.fonts.load(`700 64px ${FONT_DISPLAY}`, sample),
  ]);
}
