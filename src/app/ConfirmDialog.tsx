import { useEffect, useRef } from 'react';

export function ConfirmDialog({ title, opener, onConfirm, onCancel }: { title: string; opener: HTMLElement; onConfirm: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
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
    <h2 id="confirm-title">{title}</h2><p>現在のゲーム内容はリセットされます。</p>
    <div className="dialog-actions"><button ref={cancel} onClick={onCancel}>キャンセル</button>
      <button ref={confirm} className="primary" onClick={onConfirm}>確認して進む</button></div>
  </dialog>;
}
