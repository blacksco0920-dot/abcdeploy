import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import type { ResourceSetupGuideContent } from "./resource-setup-guides";

interface ResourceSetupGuideProps {
  content: ResourceSetupGuideContent;
  onOpenUrl?: (url: string) => Promise<void>;
}

export function ResourceSetupGuide({
  content,
  onOpenUrl,
}: ResourceSetupGuideProps) {
  const [error, setError] = useState("");

  async function open(url: string) {
    if (!onOpenUrl) return;
    setError("");
    try {
      await onOpenUrl(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "没有打开官方说明");
    }
  }

  return (
    <details className="rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>{content.summary}</span>
        <span aria-hidden className="text-[var(--muted-foreground)]">
          ⌄
        </span>
      </summary>
      <div className="space-y-3 pt-3">
        <div>
          <h4 className="m-0 text-sm font-semibold">{content.title}</h4>
          <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            {content.description}
          </p>
        </div>
        <ol className="m-0 space-y-1.5 pl-5 text-xs leading-5 text-[var(--foreground)]">
          {content.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          {content.links.map((link) => (
            <Button
              disabled={!onOpenUrl}
              key={link.url}
              onClick={() => void open(link.url)}
              size="sm"
              type="button"
              variant="secondary"
            >
              <ExternalLink />
              {link.label}
            </Button>
          ))}
        </div>
        {error ? (
          <p className="m-0 text-xs text-[var(--destructive)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
