import { useEffect, useState } from "react";
import { Button } from "@/components/ds";
import { copyText } from "@/lib/clipboard";
import styles from "./BaseUrlBar.module.scss";

export function BaseUrlBar({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className={styles.bar}>
      <span className={styles.label}>Base URL</span>
      <span className={styles.url} title={url}>
        {url}
      </span>
      <Button
        variant="on-dark"
        size="sm"
        onClick={async () => {
          if (await copyText(url)) setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
