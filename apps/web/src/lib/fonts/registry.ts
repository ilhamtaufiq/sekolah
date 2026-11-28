/*
 * Registry font untuk preferensi tampilan. Di Next.js font dimuat dengan next/font;
 * di aplikasi Vite ini, setiap variabel CSS didefinisikan di css/globals.css dan
 * font-nya dimuat dari Google Fonts di index.html.
 */
type FontEntry = { label: string; font: { variable: string } };

const entry = (label: string, variable: string): FontEntry => ({ label, font: { variable } });

export const fontRegistry = {
  geist: entry("Geist", "--font-geist"),
  inter: entry("Inter", "--font-inter"),
  notoSans: entry("Noto Sans", "--font-noto-sans"),
  nunitoSans: entry("Nunito Sans", "--font-nunito-sans"),
  figtree: entry("Figtree", "--font-figtree"),
  roboto: entry("Roboto", "--font-roboto"),
  raleway: entry("Raleway", "--font-raleway"),
  dmSans: entry("DM Sans", "--font-dm-sans"),
  publicSans: entry("Public Sans", "--font-public-sans"),
  outfit: entry("Outfit", "--font-outfit"),
  geistMono: entry("Geist Mono", "--font-geist-mono"),
  geistPixelSquare: entry("Geist Pixel Square", "--font-geist-pixel-square"),
  jetBrainsMono: entry("JetBrains Mono", "--font-jetbrains-mono"),
  geistSerif: entry("Geist Serif", "--font-geist-serif"),
  notoSerif: entry("Noto Serif", "--font-noto-serif"),
  robotoSlab: entry("Roboto Slab", "--font-roboto-slab"),
  merriweather: entry("Merriweather", "--font-merriweather"),
  lora: entry("Lora", "--font-lora"),
  playfairDisplay: entry("Playfair Display", "--font-playfair-display"),
} satisfies Record<string, FontEntry>;

export type FontKey = keyof typeof fontRegistry;

export const fontKeys = Object.keys(fontRegistry) as FontKey[];

export const fontVars = Object.values(fontRegistry).map(({ font }) => font.variable);

export const fontOptions = fontKeys.map((key) => ({
  key,
  label: fontRegistry[key].label,
}));
