import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, Card, LoadingBlock, Note, PageHeader } from "../components/ui";
import { errorMessage } from "../lib/api";
import { useCompleteGmailOAuth } from "../lib/queries";

export function GmailOAuthCallbackPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const complete = useCompleteGmailOAuth();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const state = params.get("state");
    const providerError = params.get("error");
    window.history.replaceState(null, "", location.pathname);

    if (providerError) {
      setError("Gmail access was not granted. Return to imports to try again.");
      return;
    }
    if (!code || !state) {
      setError("The Gmail response was incomplete. Start the connection again.");
      return;
    }

    void complete
      .mutateAsync({ code, state })
      .then(() => navigate("/import?tab=gmail", { replace: true }))
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }, [complete.mutateAsync, location.pathname, location.search, navigate]);

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Gmail"
        title="Connecting your account"
        description="DueRadar uses read-only access to find billing messages you choose to scan."
      />
      <Card className="p-5 sm:p-6">
        {error ? (
          <>
            <Note tone="error">{error}</Note>
            <Link to="/import?tab=gmail" className="mt-4 inline-flex">
              <Button variant="secondary">Return to Gmail import</Button>
            </Link>
          </>
        ) : (
          <LoadingBlock label="Completing the secure Gmail connection" />
        )}
      </Card>
    </div>
  );
}
