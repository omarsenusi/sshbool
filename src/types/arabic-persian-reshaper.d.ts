declare module "arabic-persian-reshaper" {
  export const ArabicShaper: { convertArabic: (s: string) => string }
  export const PersianShaper: { convertArabic: (s: string) => string }
}
