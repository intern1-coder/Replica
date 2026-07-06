import type { StylesConfig } from 'react-select';

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function getReactSelectStyles<Option = unknown>(): StylesConfig<Option, boolean> {
  const bg = cssVar('--color-surface', '#ffffff');
  const bgHover = cssVar('--color-surface-hover', '#fafafa');
  const text = cssVar('--color-text-primary', '#09090b');
  const textMuted = cssVar('--color-text-muted', '#a1a1aa');
  const border = cssVar('--color-border', '#e4e4e7');
  const brand = cssVar('--color-brand', '#09090b');
  const brandText = cssVar('--color-brand-text', '#ffffff');

  return {
    container: (base) => ({ ...base, width: '100%' }),
    control: (base, state) => ({
      ...base,
      backgroundColor: bg,
      borderColor: state.isFocused ? brand : border,
      boxShadow: state.isFocused ? `0 0 0 2px ${cssVar('--color-brand-light', 'rgba(0,0,0,0.08)')}` : 'none',
      minHeight: '38px',
      '&:hover': { borderColor: brand },
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: bg,
      border: `1px solid ${border}`,
      borderRadius: 'var(--radius-md, 8px)',
      boxShadow: 'var(--shadow-md)',
      zIndex: 9999,
    }),
    menuList: (base) => ({
      ...base,
      backgroundColor: bg,
      padding: '4px 0',
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isSelected
        ? brand
        : state.isFocused
        ? bgHover
        : bg,
      color: state.isSelected ? brandText : text,
      cursor: 'pointer',
      '&:active': {
        backgroundColor: brand,
        color: brandText,
      },
    }),
    singleValue: (base) => ({
      ...base,
      color: text,
    }),
    multiValue: (base) => ({
      ...base,
      backgroundColor: bgHover,
    }),
    multiValueLabel: (base) => ({
      ...base,
      color: text,
    }),
    multiValueRemove: (base) => ({
      ...base,
      color: textMuted,
      '&:hover': { backgroundColor: border, color: text },
    }),
    input: (base) => ({
      ...base,
      color: text,
    }),
    placeholder: (base) => ({
      ...base,
      color: textMuted,
    }),
    dropdownIndicator: (base) => ({
      ...base,
      color: textMuted,
      '&:hover': { color: text },
    }),
    clearIndicator: (base) => ({
      ...base,
      color: textMuted,
      '&:hover': { color: text },
    }),
    noOptionsMessage: (base) => ({
      ...base,
      color: textMuted,
    }),
    loadingMessage: (base) => ({
      ...base,
      color: textMuted,
    }),
  };
}

export const reactSelectMenuProps = {
  menuPortalTarget: typeof document !== 'undefined' ? document.body : null,
  menuPosition: 'fixed' as const,
  menuPlacement: 'auto' as const,
};
