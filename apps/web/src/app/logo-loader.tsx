/**
 * The brand's sunrise mark, animated: the sun rises over the horizon and its rays light up one
 * after another. Used while the job detail panel waits for scrolling to settle. Pure SVG + CSS
 * (no Lottie runtime to ship for one small loop); `motion-reduce` shows the still mark.
 */
export function LogoLoader({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3">
      <span className="flex size-14 items-center justify-center rounded-[16px] bg-[image:var(--ujc-brand-gradient)] text-white shadow-raised">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden>
          <path d="M5 17a7 7 0 0 1 14 0" className="animate-sun-rise motion-reduce:animate-none" />
          <path d="M2.5 20.5h19" />
          <path d="M4.6 9.6l1.7 1.7" className="animate-ray motion-reduce:animate-none" />
          <path d="M12 4.5V7" className="animate-ray motion-reduce:animate-none [animation-delay:160ms]" />
          <path d="M19.4 9.6l-1.7 1.7" className="animate-ray motion-reduce:animate-none [animation-delay:320ms]" />
        </svg>
      </span>
      <span className="text-footnote font-medium text-label-secondary">{label}</span>
    </div>
  );
}
