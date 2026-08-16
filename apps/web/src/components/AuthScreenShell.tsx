import { motion } from "framer-motion";
import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

function IconBack() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type AuthScreenShellProps = {
  eyebrow: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthScreenShell({ eyebrow, title, children, footer }: AuthScreenShellProps) {
  const navigate = useNavigate();

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
  };

  return (
    <div className="mx-auto flex h-svh max-h-svh min-h-0 w-full max-w-[480px] shrink-0 flex-col overflow-hidden">
      <div className="app-main-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <header className="mb-4 flex items-start justify-between gap-2">
          <motion.button
            type="button"
            className="header-icon-btn shrink-0"
            onClick={goBack}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            aria-label="Go back"
          >
            <IconBack />
          </motion.button>
          <div className="flex min-w-0 flex-1 justify-center px-1">
            <motion.img
              src="/logo-nftaix.png"
              alt="NFTaix — neon AI &amp; NFT wordmark"
              className="h-12 w-auto max-w-[min(200px,52vw)] object-contain sm:h-14"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            />
          </div>
          <div className="w-11 shrink-0" aria-hidden />
        </header>

        <motion.div
          className="neon-card neon-card--inner p-5 sm:p-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="label-caps mb-2 text-center">{eyebrow}</p>
          <h1 className="mb-6 bg-gradient-to-r from-[#00ffff] via-[#a855f7] to-[#ff00ff] bg-clip-text text-center text-2xl font-bold tracking-tight text-transparent">
            {title}
          </h1>
          {children}
          {footer ? <div className="mt-6 border-t border-white/[0.08] pt-5">{footer}</div> : null}
        </motion.div>
      </div>
    </div>
  );
}

/** Shared field styling aligned with the neon UI. */
export const authInputClassName =
  "mt-2 w-full rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-[15px] text-[var(--text-main)] shadow-inner shadow-black/20 outline-none transition-[border-color,box-shadow] placeholder:text-[#8b9bb4]/65 focus:border-[rgba(0,209,255,0.45)] focus:shadow-[0_0_20px_rgba(138,46,255,0.12)]";
