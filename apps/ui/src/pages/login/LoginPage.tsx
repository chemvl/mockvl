import { useSyncExternalStore } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Button, Notice } from "@/components/ds";
import { brand } from "@/config/brand";
import { uiEnv } from "@/config/env";
import { hasSession, subscribeSession } from "@/features/auth/token-store";
import { useGoogleSignIn } from "@/features/auth/use-google-sign-in";
import styles from "./LoginPage.module.scss";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const signedIn = useSyncExternalStore(subscribeSession, hasSession);
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const google = useGoogleSignIn({ onSignedIn: () => navigate(from, { replace: true }) });

  if (signedIn && !google.signingIn) return <Navigate to={from} replace />;

  const hint = uiEnv.googleHd ? `Use your ${uiEnv.googleHd} Google account.` : "Use your work Google account.";

  return (
    <div className={styles.split}>
      <div className={styles.left}>
        <div className={styles.brand}>
          <div className={styles.logo}>{"{ }"}</div>
          <span className={styles.brandName}>{brand.name}</span>
        </div>
        <div className={styles.hero}>
          <h1 className={styles.heroTitle}>Mock servers from your API schema</h1>
          <p className={styles.heroText}>
            Upload an OpenAPI or Postman file, or point to its URL. You get a live URL that answers with your examples.
          </p>
        </div>
        <span className={styles.footnote}>Powered by Stoplight Prism · OpenAPI 3.x · Postman v2 · JSON or YAML</span>
      </div>
      <div className={styles.right}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Sign in</h2>
          </div>
          <Button fullWidth disabled={!google.ready || google.signingIn} onClick={google.start}>
            <span className={styles.googleMark}>G</span>
            {google.signingIn ? "Signing in…" : "Continue with Google"}
          </Button>
          {google.error && <Notice kind="error">{google.error}</Notice>}
          <span className={styles.hint}>{hint}</span>
          <div className={styles.divider} />
          <span className={styles.hint}>You get a personal workspace the first time you sign in.</span>
        </div>
      </div>
    </div>
  );
}
