import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import "./confirmation-dialog.css";

export function ConfirmationDialog({ confirmation, onCancel, onConfirm }) {
  const titleId = useId();
  const descriptionId = useId();
  const impactId = useId();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const cancelHandler = useRef(onCancel);
  cancelHandler.current = onCancel;
  const isOpen = Boolean(confirmation);
  const returnFocusId = confirmation?.returnFocusId;

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelHandler.current();
      } else if (event.key === "Tab") {
        const focusable = [...(dialogRef.current?.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)") || [])];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!dialogRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (returnFocusId) document.getElementById(returnFocusId)?.focus();
      else if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, returnFocusId]);

  if (!confirmation) return null;

  return createPortal(
    <div className="confirmation-overlay" onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="confirmation-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={confirmation.impact ? `${descriptionId} ${impactId}` : descriptionId}>
        <div className="confirmation-dialog-eyebrow">Confirm action</div>
        <h2 id={titleId}>{confirmation.title}</h2>
        <p id={descriptionId}>{confirmation.description}</p>
        {confirmation.impact && <div className="confirmation-dialog-impact" id={impactId}><strong>What happens next</strong><span>{confirmation.impact}</span></div>}
        <div className="confirmation-dialog-actions">
          <button type="button" className="confirmation-dialog-cancel" ref={cancelRef} onClick={onCancel}>Cancel</button>
          <button type="button" className={`confirmation-dialog-confirm${confirmation.tone === "danger" ? " confirmation-dialog-confirm--danger" : ""}`} onClick={onConfirm}>{confirmation.confirmLabel || "Continue"}</button>
        </div>
      </section>
    </div>,
    document.body
  );
}
