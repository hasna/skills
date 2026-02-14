/**
 * Slide layout and design logic
 */

export const THEME_COLORS: Record<string, { primary: string; secondary: string; background: string; text: string; accent: string }> = {
  corporate: { primary: "003366", secondary: "0066CC", background: "FFFFFF", text: "333333", accent: "FF6B35" },
  creative: { primary: "FF6B35", secondary: "004E89", background: "FFFFFF", text: "333333", accent: "7209B7" },
  minimal: { primary: "2C3E50", secondary: "7F8C8D", background: "FFFFFF", text: "333333", accent: "3498DB" },
  dark: { primary: "00AAFF", secondary: "FF5577", background: "1A1A2E", text: "EAEAEA", accent: "00FF88" },
  light: { primary: "3498DB", secondary: "9B59B6", background: "F8F9FA", text: "2C3E50", accent: "E74C3C" },
  tech: { primary: "00FF88", secondary: "FF00FF", background: "0A0E27", text: "EAEAEA", accent: "00AAFF" },
};

export function getThemeColors(theme: string, primaryColor?: string, secondaryColor?: string) {
  const themeData = THEME_COLORS[theme] || THEME_COLORS.minimal;
  return {
    ...themeData,
    primary: primaryColor || themeData.primary,
    secondary: secondaryColor || themeData.secondary,
  };
}

export function getLogoPosition(position: string): { x: number; y: number } {
  const positions: Record<string, { x: number; y: number }> = {
    "top-left": { x: 0.3, y: 0.2 },
    "top-right": { x: 8.5, y: 0.2 },
    "bottom-left": { x: 0.3, y: 4.8 },
    "bottom-right": { x: 8.5, y: 4.8 },
  };
  return positions[position] || positions["bottom-right"];
}
