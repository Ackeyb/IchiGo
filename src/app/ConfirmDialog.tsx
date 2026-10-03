import { useEffect, useRef } from 'react';

export function ConfirmDialog({ title, description = '現在のゲーム内容はリセットされます。', confirmLabel = '確認して進む', opener, onConfirm, onCancel }: {
  title: string;
  description?: string;
  confirmLabel?: string;
  opener: HTMLElement;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  // The dialog owns focus lifecycle; its caller owns the captured revision and confirmed action.
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => { element.close(); if (opener.isConnected) opener.focus(); };
  }, [opener]);
  return <dialog ref={dialog} aria-labelledby="confirm-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      if (event.shiftKey && document.activeElement === cancel.current) {
        event.preventDefault(); confirm.current?.focus();
      } else if (!event.shiftKey && document.activeElement === confirm.current) {
        event.preventDefault(); cancel.current?.focus();
      }
    }}>
    <h2 id="confirm-title">{title}</h2><p>{description}</p>
    <div className="dialog-actions"><button ref={cancel} onClick={onCancel}>キャンセル</button>
      <button ref={confirm} className="primary" onClick={onConfirm}>{confirmLabel}</button></div>
  </dialog>;
}
