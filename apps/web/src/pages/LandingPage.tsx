import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";

function IconLayers() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTrend() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M4 18V6M4 18h16M8 14l4-4 4 4M12 6v8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="9" cy="7" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20v-1.5A4 4 0 017 15h3a4 4 0 014 4v1M14 20v-1a3 3 0 013-3h1" strokeLinecap="round" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconZap() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconWhatsApp() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="shrink-0 opacity-90">
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0012.04 2zm.01 1.83c2.2 0 4.26.86 5.82 2.42a8.225 8.225 0 012.41 5.83c0 4.54-3.7 8.23-8.24 8.23-1.48 0-2.93-.39-4.19-1.12l-.3-.18-3.12.82.84-3.04-.2-.32a8.181 8.181 0 01-1.13-4.22c-.01-4.54 3.7-8.24 8.25-8.24zm4.52 6.22c-.25-.12-1.47-.72-1.69-.81-.22-.08-.37-.12-.53.12-.16.25-.62.81-.76.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.53-1.27-.72-1.74-.19-.48-.41-.42-.53-.43h-.45c-.14 0-.43.05-.66.31-.22.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.2 1.13.17 1.56.1.48-.08 1.47-.6 1.67-1.18.21-.58.21-1.08.15-1.18-.07-.1-.23-.16-.48-.29z" />
    </svg>
  );
}

function IconTelegram() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="shrink-0 opacity-90">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
    </svg>
  );
}

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-40px" },
  transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
};

const containerClass = "mx-auto w-full max-w-[min(1600px,100%)] px-4 sm:px-6 lg:px-10 xl:px-14";

/** Landing mascots (served from `public/landing/`) */
const LANDING_IMG = {
  hero: "/landing/panda-create-collect-earn.png",
  engineer: "/landing/panda-engineer.png",
  professional: "/landing/panda-professional.png",
  innovation: "/landing/panda-innovation.png",
} as const;

export function LandingPage() {
  const [searchParams] = useSearchParams();
  const refFromUrl = searchParams.get("ref") ?? searchParams.get("sponsor") ?? "";
  const loginHref = refFromUrl ? `/login?ref=${encodeURIComponent(refFromUrl)}` : "/login";
  const registerHref = refFromUrl ? `/register?ref=${encodeURIComponent(refFromUrl)}` : "/register";

  return (
    <div className="relative flex h-svh max-h-svh min-h-0 w-full flex-col overflow-hidden">
      {/* ambient + grid */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-[15%] top-[-15%] h-[50vh] w-[80vw] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(0,209,255,0.14)_0%,transparent_62%)] blur-3xl xl:h-[55vh]" />
        <div className="absolute -right-[10%] top-[5%] h-[45vh] w-[70vw] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(138,46,255,0.16)_0%,transparent_62%)] blur-3xl" />
        <div className="absolute bottom-[-10%] left-[20%] h-[42vh] w-[65vw] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,47,209,0.1)_0%,transparent_68%)] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: `linear-gradient(rgba(139,155,180,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(139,155,180,0.07) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
            maskImage: "linear-gradient(180deg, black 0%, black 70%, transparent 100%)",
          }}
        />
      </div>

      <header className="relative z-20 shrink-0 border-b border-white/[0.07] bg-[rgba(5,7,13,0.78)] backdrop-blur-xl">
        <div className={`${containerClass} flex items-center justify-between gap-4 py-3.5 md:py-4`}>
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <img src="/logo-nftaix.png" alt="NFTaix — neon AI &amp; NFT wordmark" className="h-9 w-auto object-contain sm:h-11" />
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-[var(--text-sub)] md:flex" aria-label="Page">
            <a href="#features" className="transition-colors hover:text-[var(--neon-cyan)]">
              Features
            </a>
            <a href="#platform" className="transition-colors hover:text-[var(--neon-cyan)]">
              Platform
            </a>
            <a href="#how" className="transition-colors hover:text-[var(--neon-cyan)]">
              How it works
            </a>
            <a href="#faq" className="transition-colors hover:text-[var(--neon-cyan)]">
              FAQ
            </a>
          </nav>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Link
              to={loginHref}
              className="btn-neon-ghost px-3 py-2.5 text-sm font-semibold text-[var(--text-main)] transition-transform hover:scale-[1.02] active:scale-[0.98] sm:px-5"
            >
              Sign in
            </Link>
            <Link
              to={registerHref}
              className="btn-neon-fill px-3 py-2.5 text-sm font-semibold shadow-[0_0_24px_rgba(138,46,255,0.28)] transition-transform hover:scale-[1.02] active:scale-[0.98] sm:px-5"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main
        id="main"
        className="app-main-scroll relative z-10 min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-[max(2rem,env(safe-area-inset-bottom))]"
      >
        {/* Hero — full-width band on large screens */}
        <section className="relative border-b border-white/[0.05] pb-14 pt-8 md:pb-20 md:pt-12 lg:pt-16">
          <div className={`${containerClass} grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 xl:gap-20`}>
            <div className="text-center lg:text-left">
              <motion.h1
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
                className="mb-5 text-balance text-4xl font-bold leading-[1.12] tracking-tight sm:text-5xl lg:text-6xl xl:text-[3.5rem]"
              >
                <span className="bg-gradient-to-r from-[#00ffff] via-[#a855f7] to-[#ff00ff] bg-clip-text text-transparent">
                  Your AI-ready hub for NFTs, markets, and wallet-backed automation
                </span>
              </motion.h1>
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap lg:justify-start"
              >
                <Link
                  to={registerHref}
                  className="btn-neon-fill inline-flex items-center justify-center px-8 py-3.5 text-base font-semibold shadow-[0_0_32px_rgba(0,209,255,0.22)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  Create free account
                </Link>
                <Link
                  to={loginHref}
                  className="btn-neon-ghost inline-flex items-center justify-center px-8 py-3.5 text-base font-semibold transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  I already have an account
                </Link>
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
              className="relative mx-auto w-full max-w-lg lg:mx-0 lg:max-w-none"
            >
              <div className="absolute -inset-4 rounded-[28px] bg-gradient-to-br from-[rgba(0,209,255,0.15)] via-[rgba(138,46,255,0.12)] to-[rgba(255,47,209,0.12)] blur-2xl" aria-hidden />
              <div className="neon-card neon-card--inner relative overflow-hidden p-3 sm:p-4">
                <div className="relative overflow-hidden rounded-[20px] ring-1 ring-white/10">
                  <img
                    src={LANDING_IMG.hero}
                    alt="NFTaix mascot in a creative studio—mint ideas, collect NFTs, automate workflows"
                    width={800}
                    height={800}
                    className="mx-auto h-auto w-full max-h-[min(420px,52vh)] object-cover object-center sm:max-h-[min(480px,50vh)] lg:max-h-[min(520px,56vh)]"
                    loading="eager"
                    decoding="async"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#05070d]/95 via-[#05070d]/40 to-transparent pt-24 pb-4 sm:pt-28">
                    <div className="flex flex-wrap justify-center gap-2 px-3">
                      {(["Mint", "Collect", "Automate"] as const).map((word) => (
                        <span
                          key={word}
                          className="rounded-full border border-[rgba(0,255,255,0.35)] bg-black/45 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--neon-cyan)] backdrop-blur-md sm:text-sm"
                        >
                          {word}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.08] pt-4">
                  <div>
                    <p className="label-caps mb-1">At a glance</p>
                  </div>
                  <div className="icon-pill flex h-11 w-11 shrink-0 items-center justify-center text-[var(--neon-cyan)] sm:h-12 sm:w-12">
                    <IconZap />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {[
                    { label: "Rewards", value: "Tracked", accent: "text-[var(--positive)]" },
                    { label: "NFT floor", value: "Live", accent: "text-[var(--neon-cyan)]" },
                    { label: "Automation", value: "Rules", accent: "text-[#ff2fd1]" },
                    { label: "Wallet", value: "Ready", accent: "text-[#8a2eff]" },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-3 backdrop-blur-sm sm:px-4"
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-sub)] sm:text-xs">{row.label}</p>
                      <p className={`mt-0.5 text-base font-semibold sm:text-lg ${row.accent}`}>{row.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Stats strip — full container width */}
        <section className="border-b border-white/[0.05] bg-[rgba(8,11,22,0.45)] py-10 backdrop-blur-sm">
          <div className={containerClass}>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8 lg:gap-10">
              {[
                { n: "01", t: "NFT + markets" },
                { n: "02", t: "Bot-friendly" },
                { n: "03", t: "Wallet-native" },
                { n: "04", t: "AI-ready" },
              ].map((s) => (
                <div key={s.n} className="text-center md:text-left">
                  <p className="mb-2 font-mono text-2xl font-bold tabular-nums text-[var(--neon-cyan)]/90 lg:text-3xl">{s.n}</p>
                  <p className="font-semibold text-[var(--text-main)]">{s.t}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <motion.section className={`${containerClass} mt-14 border-b border-white/[0.05] pb-14 sm:mt-16 sm:pb-16`} {...fadeUp}>
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14 xl:gap-16">
            <div className="relative mx-auto w-full max-w-lg lg:order-none lg:mx-0 lg:max-w-none">
              <div
                className="absolute -inset-3 rounded-[28px] bg-gradient-to-br from-[rgba(255,214,0,0.12)] via-transparent to-[rgba(0,209,255,0.1)] blur-2xl"
                aria-hidden
              />
              <div className="neon-card neon-card--inner relative overflow-hidden p-2 sm:p-3">
                <img
                  src={LANDING_IMG.engineer}
                  alt="NFTaix mascot engineer with blueprints and tablet at a construction site"
                  width={900}
                  height={900}
                  className="w-full rounded-[20px] object-cover object-center"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
            <div className="text-center lg:text-left">
              <p className="label-caps mb-3">Under the hood</p>
              <h2 className="text-2xl font-bold tracking-tight text-[var(--text-main)] sm:text-3xl xl:text-4xl">
                Contracts, bots, and humans share the same glass cockpit
              </h2>
            </div>
          </div>
        </motion.section>

        <div id="features" className="scroll-mt-24" />

        <section className={`${containerClass} mt-16 sm:mt-20`}>
          <div className="mb-10 max-w-2xl lg:mb-14">
            <p className="label-caps mb-3">Why builders &amp; collectors stay</p>
            <h2 className="text-3xl font-bold tracking-tight text-[var(--text-main)] sm:text-4xl">
              NFT liquidity, trading rails, and automation—without the clutter
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                icon: <IconLayers />,
                title: "NFT marketplace layer",
              },
              {
                icon: <IconTrend />,
                title: "Trading & rewards",
              },
              {
                icon: <IconUsers />,
                title: "Community graph",
              },
              {
                icon: <IconShield />,
                title: "Wallet-ready security",
              },
            ].map((item, i) => (
              <motion.article
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                className="neon-card neon-card--inner flex flex-col p-6 transition-shadow hover:shadow-[0_0_40px_rgba(138,46,255,0.12)]"
              >
                <div className="icon-pill mb-4 inline-flex h-11 w-11 items-center justify-center text-[var(--neon-cyan)]">{item.icon}</div>
                <h3 className="text-lg font-bold text-[var(--text-main)]">{item.title}</h3>
              </motion.article>
            ))}
          </div>
        </section>

        <div id="platform" className="scroll-mt-24" />

        <motion.section className={`${containerClass} mt-20 sm:mt-28`} {...fadeUp}>
          <div className="mb-10 flex flex-col gap-4 lg:mb-12 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="label-caps mb-3">Inside the app</p>
              <h2 className="text-3xl font-bold tracking-tight text-[var(--text-main)] sm:text-4xl">Platform modules</h2>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:gap-5">
            {[
              {
                title: "Home",
                span: "md:col-span-1",
              },
              {
                title: "Income",
                span: "md:col-span-1",
              },
              {
                title: "Market",
                span: "md:col-span-2 lg:col-span-1",
              },
              {
                title: "Teams",
                span: "md:col-span-1",
              },
              {
                title: "Upgrade",
                span: "md:col-span-1",
              },
              {
                title: "Auto-trade",
                span: "md:col-span-2 lg:col-span-2 xl:col-span-3",
              },
            ].map((mod, i) => (
              <motion.div
                key={mod.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.4, delay: i * 0.04 }}
                className={`neon-card neon-card--inner p-6 sm:p-7 ${mod.span}`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-gradient-to-r from-[#00d1ff] to-[#8a2eff]" />
                  <h3 className="text-lg font-bold text-[var(--text-main)]">{mod.title}</h3>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        <div id="how" className="scroll-mt-24" />

        <motion.section className={`${containerClass} mt-20 sm:mt-28`} {...fadeUp}>
          <div className="neon-card neon-card--inner overflow-hidden">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16 xl:gap-20">
              <div className="p-6 sm:p-10 lg:p-12 xl:p-14">
                <p className="label-caps mb-3">How it flows</p>
                <h2 className="text-2xl font-bold tracking-tight text-[var(--text-main)] sm:text-3xl xl:text-4xl">
                  Built for collectors on the move—expanded for desk-bound strategists
                </h2>
              </div>
              <div className="relative min-h-[280px] lg:min-h-[min(520px,70vh)]">
                <div className="absolute inset-0 bg-gradient-to-br from-[rgba(0,209,255,0.15)] via-[rgba(138,46,255,0.1)] to-[rgba(255,47,209,0.12)]" />
                <img
                  src={LANDING_IMG.professional}
                  alt="NFTaix mascot professional with briefcase and city lights—strategy and on-chain execution"
                  width={900}
                  height={900}
                  className="relative z-[1] h-full min-h-[280px] w-full object-cover object-[center_15%] lg:min-h-[min(520px,70vh)]"
                  loading="lazy"
                  decoding="async"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-[#0b0f1a] via-[#0b0f1a]/85 to-transparent pt-32 pb-8">
                  <img
                    src="/logo-nftaix.png"
                    alt="NFTaix — neon AI &amp; NFT wordmark"
                    className="mx-auto h-10 w-auto max-w-[min(220px,70vw)] object-contain drop-shadow-[0_0_24px_rgba(0,255,255,0.35)] sm:h-12"
                  />
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section className={`${containerClass} mt-20 sm:mt-28`} {...fadeUp}>
          <p className="label-caps mb-3 text-center">Voices</p>
          <h2 className="mb-12 text-center text-3xl font-bold text-[var(--text-main)] sm:text-4xl">What operators tell us</h2>
          <div className="grid gap-6 md:grid-cols-3 lg:gap-8">
            {["Studio lead", "Community manager", "Quant-minded trader"].map((role) => (
              <div key={role} className="neon-card neon-card--inner p-6 sm:p-7">
                <p className="text-sm font-semibold uppercase tracking-wider text-[var(--neon-cyan)]">{role}</p>
              </div>
            ))}
          </div>
        </motion.section>

        <div id="faq" className="scroll-mt-24" />

        <motion.section className={`${containerClass} mt-20 sm:mt-28`} {...fadeUp}>
          <div className="neon-card neon-card--inner mb-12 overflow-hidden sm:mb-14">
            <div className="grid items-center gap-8 p-6 sm:grid-cols-[minmax(0,220px)_1fr] sm:gap-10 sm:p-10 lg:grid-cols-[minmax(0,280px)_1fr] lg:p-12">
              <div className="mx-auto flex w-full max-w-[220px] justify-center sm:mx-0 lg:max-w-[280px]">
                <div className="relative w-full">
                  <div
                    className="absolute -inset-2 rounded-3xl bg-[radial-gradient(ellipse_at_center,rgba(0,209,255,0.2)_0%,transparent_70%)] blur-xl"
                    aria-hidden
                  />
                  <img
                    src={LANDING_IMG.innovation}
                    alt="NFTaix mascot innovator with tablet and assistant—precision and care"
                    width={560}
                    height={560}
                    className="relative w-full rounded-2xl object-contain"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
              <div className="text-center sm:text-left">
                <p className="label-caps mb-3">Innovation &amp; clarity</p>
                <h2 className="text-xl font-bold text-[var(--text-main)] sm:text-2xl lg:text-3xl">
                  Answers that respect your time
                </h2>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-3xl text-center">
            <p className="label-caps mb-3">FAQ</p>
            <h2 className="text-3xl font-bold text-[var(--text-main)] sm:text-4xl">Common answers</h2>
          </div>
          <div className="mx-auto mt-12 max-w-3xl space-y-3">
            {[
              "Do I need a wallet to start?",
              "Which chain do you support?",
              "Is the mobile app different from desktop?",
              "Does NFTaix trade or mint NFTs for me with AI?",
              "How do invites work?",
              "Where do I sign in after registering?",
            ].map((q) => (
              <div key={q} className="neon-card neon-card--inner px-5 py-5 sm:px-6 sm:py-6">
                <p className="font-semibold text-[var(--text-main)]">{q}</p>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section className={`${containerClass} mt-20 sm:mt-28`} {...fadeUp}>
          <div className="rounded-[28px] border border-transparent bg-gradient-to-r from-[rgba(0,209,255,0.22)] via-[rgba(138,46,255,0.22)] to-[rgba(255,47,209,0.22)] p-[1px] shadow-[0_0_60px_rgba(138,46,255,0.12)]">
            <div className="rounded-[27px] bg-[rgba(6,9,18,0.92)] px-6 py-12 backdrop-blur-xl sm:px-12 sm:py-16 lg:px-16">
              <div className="mx-auto max-w-3xl text-center">
                <h2 className="mb-10 text-2xl font-bold text-[var(--text-main)] sm:text-3xl lg:text-4xl">Ship your next NFT chapter</h2>
                <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:justify-center">
                  <Link
                    to={registerHref}
                    className="btn-neon-fill inline-flex items-center justify-center px-10 py-3.5 text-base font-semibold transition-transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    Get started
                  </Link>
                  <Link
                    to={loginHref}
                    className="btn-neon-ghost inline-flex items-center justify-center px-10 py-3.5 text-base font-semibold transition-transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    Sign in
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        <footer className={`${containerClass} mt-20 border-t border-white/[0.08] pb-10 pt-12 sm:mt-28 sm:pb-12`}>
          <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5 lg:gap-12">
            <div className="lg:col-span-2">
              <img src="/logo-nftaix.png" alt="NFTaix — neon AI &amp; NFT wordmark" className="mb-4 h-10 w-auto object-contain opacity-95" />
            </div>
            <div>
              <p className="label-caps mb-4">Explore</p>
              <ul className="space-y-2.5 text-sm text-[var(--text-sub)]">
                <li>
                  <a href="#features" className="transition-colors hover:text-[var(--neon-cyan)]">
                    Features
                  </a>
                </li>
                <li>
                  <a href="#platform" className="transition-colors hover:text-[var(--neon-cyan)]">
                    Platform
                  </a>
                </li>
                <li>
                  <a href="#faq" className="transition-colors hover:text-[var(--neon-cyan)]">
                    FAQ
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="label-caps mb-4">Community</p>
              <ul className="space-y-2.5 text-sm text-[var(--text-sub)]">
                <li>
                  <a
                    href="https://whatsapp.com/channel/0029VbCmCmnHVvTgS6HGBY16"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 transition-colors hover:text-[var(--neon-cyan)]"
                  >
                    <IconWhatsApp />
                    WhatsApp Group
                  </a>
                </li>
                <li>
                  <a
                    href="https://t.me/nftaix"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 transition-colors hover:text-[var(--neon-cyan)]"
                  >
                    <IconTelegram />
                    Telegram Channel
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="label-caps mb-4">Account</p>
              <ul className="space-y-2.5 text-sm">
                <li>
                  <Link to={loginHref} className="text-[var(--text-sub)] transition-colors hover:text-[var(--neon-cyan)]">
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link to={registerHref} className="text-[var(--text-sub)] transition-colors hover:text-[var(--neon-cyan)]">
                    Register
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <p className="mt-12 border-t border-white/[0.06] pt-8 text-center text-xs text-[var(--text-sub)] sm:text-sm">
            © {new Date().getFullYear()} NFTaix
          </p>
        </footer>
      </main>
    </div>
  );
}
