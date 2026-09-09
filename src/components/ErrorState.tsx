"use client";

import { ReactNode } from "react";

interface Props {
  title: string;
  message: string;
  retry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
}

/** Unified error state (§16) — never a blank screen. */
export default function ErrorState({ title, message, retry, retryLabel = "Retry", children }: Props) {
  return (
    <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-2xl">⚠️</span>
        <div className="flex-1">
          <h3 className="font-semibold text-red-300">{title}</h3>
          <p className="mt-1 text-sm text-red-200/80">{message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {retry && (
              <button onClick={retry} className="btn-primary text-sm">
                {retryLabel}
              </button>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
