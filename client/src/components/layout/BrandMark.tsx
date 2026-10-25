/**
 * Replaceable brand placeholder. Swap BRAND_NAME and the SVG mark when the
 * startup identity is decided; nothing else depends on them.
 */
export const BRAND_NAME = '[Startup Name]';

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#DCE8C7" />
      <path d="M10 6c0 6 12 6 12 12s-12 6-12 8" stroke="#344536" strokeWidth="2" strokeLinecap="round" />
      <path d="M22 6c0 6-12 6-12 12s12 6 12 8" stroke="#344536" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function BrandLockup() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <div className="leading-tight">
        <div className="text-sm font-semibold">{BRAND_NAME}</div>
        <div className="text-[11px] text-ink-soft">Genomic Intelligence</div>
      </div>
    </div>
  );
}
