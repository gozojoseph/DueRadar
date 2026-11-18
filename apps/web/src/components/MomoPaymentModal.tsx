import { useState } from "react";
import { Smartphone } from "lucide-react";
import { Button, Input, Modal, Note } from "./ui";
import type { MomoNetwork } from "../lib/types";

const NETWORKS: Array<{ id: MomoNetwork; label: string; hint: string }> = [
  { id: "mtn", label: "MTN MoMo", hint: "024 · 054 · 055 · 059" },
  { id: "telecel", label: "Telecel Cash", hint: "020 · 050" },
  { id: "at", label: "AT Money", hint: "026 · 027 · 056 · 057" },
];

/**
 * Shared mobile-money checkout step for the Yebeck provider: Yebeck has no
 * hosted checkout, so DueRadar collects the network and number itself and
 * the user approves a prompt on their phone.
 */
export function MomoPaymentModal({
  open,
  planLabel,
  amount,
  busy,
  error,
  onClose,
  onPay,
}: {
  open: boolean;
  planLabel: string;
  amount: string;
  busy: boolean;
  error: string | null;
  onClose: () => void | Promise<void>;
  onPay: (details: { network: MomoNetwork; msisdn: string; name: string }) => void | Promise<void>;
}) {
  const [network, setNetwork] = useState<MomoNetwork>("mtn");
  const [msisdn, setMsisdn] = useState("");
  const [name, setName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit() {
    const digits = msisdn.replace(/\D/g, "");
    if (digits.length < 9) {
      setLocalError("Enter the mobile money number to charge, for example 024 123 4567.");
      return;
    }
    setLocalError(null);
    void onPay({ network, msisdn, name: name.trim() });
  }

  return (
    <Modal
      open={open}
      onClose={() => void onClose()}
      title={`Pay for ${planLabel} by mobile money`}
      description="Choose your network and enter the number to charge. You will approve a payment prompt on your phone."
      size="lg"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={busy} onClick={() => void onClose()}>
            Cancel
          </Button>
          <Button loading={busy} disabled={busy} onClick={submit}>
            Pay GHS {amount}
          </Button>
        </div>
      }
    >
      {error ? (
        <Note tone="error" className="mb-4">
          {error}
        </Note>
      ) : null}
      {localError ? (
        <Note tone="error" className="mb-4">
          {localError}
        </Note>
      ) : null}

      <p className="mb-2 text-xs font-semibold text-muted">Mobile money network</p>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Mobile money network">
        {NETWORKS.map((entry) => (
          <label
            key={entry.id}
            className={`cursor-pointer rounded-2xl border p-3 transition ${
              network === entry.id
                ? "border-brand-600 bg-brand-50/60 shadow-sm"
                : "border-line hover:border-line-strong"
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-bold text-ink">
              <input
                type="radio"
                name="momo-network"
                value={entry.id}
                checked={network === entry.id}
                onChange={() => setNetwork(entry.id)}
                className="h-4 w-4 accent-brand-600"
              />
              {entry.label}
            </span>
            <span className="mt-1 block text-[0.7rem] text-muted">{entry.hint}</span>
          </label>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">Mobile money number</span>
          <Input
            value={msisdn}
            onChange={(event) => setMsisdn(event.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="024 123 4567"
            aria-label="Mobile money number"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">
            Account name (optional)
          </span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            placeholder="Ama Owusu"
            aria-label="Account name"
          />
        </label>
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
        <Smartphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        A payment prompt will pop up on your phone. Approval usually takes a few seconds; the
        plan activates as soon as the payment is confirmed.
      </p>
    </Modal>
  );
}
