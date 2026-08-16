import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { HeaderStatsBar } from "./HeaderStatsBar";

function IconBack() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SubScreenHeader() {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/home");
  };

  const onLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <>
      <header className="mb-3 flex items-start justify-between gap-2">
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
        <div className="flex min-w-0 flex-1 flex-col items-center px-1 text-center">
          <motion.img
            src="/logo-nftaix.png"
            alt="NFTaix — neon AI &amp; NFT wordmark"
            className="h-14 w-auto max-w-[min(220px,65vw)] object-contain sm:h-16"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          />
        </div>
        <motion.button
          type="button"
          className="header-icon-btn shrink-0"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          aria-label="Log out"
          onClick={onLogout}
        >
          <IconLogout />
        </motion.button>
      </header>

      <div className="mb-4">
        <HeaderStatsBar />
      </div>
    </>
  );
}
