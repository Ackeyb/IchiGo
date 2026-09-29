import { useEffect, useRef, useState } from 'react';
import type { DiceMode, DieResult } from '../game/types';
import { DicePresentationController } from '../dice/presentationController';
import { prefersReducedMotion as defaultReducedMotion } from '../dice/presentationController';
import type {
  DicePresentationKind,
  DicePresentationOutcome,
  DiceRendererFactory,
} from '../dice/types';
import { DiceView } from './DiceView';
import type { SoundCue } from './sound';

const defaultRendererFactory: DiceRendererFactory = async (container) => {
  const { createThreeDiceRenderer } = await import('../dice/three/ThreeDiceRenderer');
  return createThreeDiceRenderer(container);
};

const fallbackLabels = {
  'reduced-motion': '動きを減らす設定のため2D表示',
  unsupported: 'この環境では2D表示',
  initialization: '3Dを開始できないため2D表示',
  presentation: '3D表示を完了できないため2D表示',
  timeout: '3D表示が時間内に完了しないため2D表示',
  'context-lost': '3D表示が中断されたため2D表示',
} as const;

export type DicePresentationConfig = Readonly<{
  createRenderer?: DiceRendererFactory;
  timeoutMs?: number;
  prefersReducedMotion?: () => boolean;
  resultStepMs?: number;
}>;

export type DiceResultPresentation =
  | Readonly<{
    kind: 'normal';
    gainedScore: number;
    scoringCount: number;
    outCount: number;
    outcome: 'continue' | 'turnEnd' | 'complete';
    totalCompletionCount: number;
    multiplier: number;
  }>
  | Readonly<{
    kind: 'penalty';
    basePenalty: number;
    multiplier: number;
    finalPenalty: number;
  }>;

export function DicePresentation({
  dice,
  diceMode,
  kind,
  revision,
  busy,
  onReveal,
  onPresented,
  presentation,
  onCue,
  config,
}: {
  dice?: readonly DieResult[] | undefined;
  diceMode: DiceMode;
  kind: DicePresentationKind;
  revision: number;
  busy: boolean;
  onReveal: (revision: number) => void;
  onPresented: (revision: number) => void;
  presentation?: DiceResultPresentation | undefined;
  onCue?: ((cue: SoundCue) => void) | undefined;
  config?: DicePresentationConfig | undefined;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<DicePresentationController | undefined>(undefined);
  const [outcome, setOutcome] = useState<DicePresentationOutcome>();
  const [completedId, setCompletedId] = useState<string>();
  const [stage, setStage] = useState(0);
  const createRenderer = config?.createRenderer ?? defaultRendererFactory;
  const timeoutMs = config?.timeoutMs;
  const prefersReducedMotion = config?.prefersReducedMotion;
  const requestId = `${kind}/${revision}`;
  const hasDice = !!dice;

  useEffect(() => {
    if (!container.current) return;
    const options = {
      createRenderer,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(prefersReducedMotion === undefined ? {} : { prefersReducedMotion }),
    };
    const instance = new DicePresentationController(container.current, options);
    controller.current = instance;
    return () => {
      instance.dispose();
      if (controller.current === instance) controller.current = undefined;
    };
  }, [createRenderer, prefersReducedMotion, timeoutMs]);

  useEffect(() => {
    if (!hasDice || !dice) {
      controller.current?.clear();
      setOutcome(undefined);
      setCompletedId(undefined);
      setStage(0);
      return;
    }
    if (!busy || !controller.current) return;
    let current = true;
    let secondFrame = 0;
    let firstFrame = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    setOutcome(undefined);
    setStage(0);
    const reduced = (prefersReducedMotion ?? defaultReducedMotion)();
    const stepMs = reduced ? 0 : (config?.resultStepMs ?? 180);
    const at = (step: number, callback: () => void) => {
      if (stepMs === 0) callback();
      else timers.push(setTimeout(() => { if (current) callback(); }, stepMs * step));
    };
    const reveal = () => {
      if (!current) return;
      onReveal(revision);
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => onPresented(revision));
      });
    };
    const finish = (next: DicePresentationOutcome) => {
      if (!current) return;
      setOutcome(next);
      setCompletedId(requestId);
      setStage(1);
      onCue?.('impact');
      if (presentation?.kind === 'normal') {
        if (presentation.outCount > 0) onCue?.('out');
        if (presentation.scoringCount > 0) onCue?.('scoring');
        at(1, () => setStage(2));
        at(2, () => setStage(3));
        at(3, () => {
          setStage(4);
          if (presentation.outcome === 'complete') onCue?.('complete');
          else if (presentation.outcome === 'turnEnd') onCue?.('turn-end');
        });
        at(4, reveal);
      } else if (presentation?.kind === 'penalty') {
        at(1, () => setStage(2));
        at(2, () => setStage(3));
        at(3, () => { setStage(4); onCue?.('penalty'); });
        at(4, reveal);
      } else reveal();
    };
    const result = controller.current.present({ id: requestId, dice, kind });
    if (result instanceof Promise) void result.then(finish);
    else finish(result);
    return () => {
      current = false;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [busy, config?.resultStepMs, hasDice, kind, onCue, onPresented, onReveal, prefersReducedMotion, requestId, revision]);

  const currentOutcome = completedId === requestId ? outcome : undefined;
  const revealed = !!dice && (!busy || completedId === requestId);
  const useThree = currentOutcome?.mode !== 'fallback';
  return <div className={`dice-presentation ${dice ? '' : 'is-idle'} ${useThree ? 'use-three' : 'use-fallback'}`}>
    <div ref={container} className="three-dice-stage" aria-hidden="true" />
    {currentOutcome?.mode === 'fallback' && <p className="renderer-status">{fallbackLabels[currentOutcome.reason]}</p>}
    {revealed && <div className="dice-result-details">
      <DiceView dice={dice} diceMode={diceMode} kind={kind} removing={stage >= 3} />
      {presentation?.kind === 'normal' && <div className="result-sequence" aria-live="polite">
        {stage >= 2 && <strong className={presentation.gainedScore > 0 ? 'score-pop' : 'no-score'}>
          {presentation.gainedScore > 0 ? `今回 +${presentation.gainedScore}点` : 'NO SCORE'}</strong>}
        {stage >= 4 && presentation.outcome === 'turnEnd' && <b>TURN END</b>}
        {stage >= 4 && presentation.outcome === 'continue' && <b>次のROLLへ</b>}
        {stage >= 4 && presentation.outcome === 'complete' && <div className="complete-pop"><b>COMPLETE!</b>
          <span>累積完走 {presentation.totalCompletionCount} · ペナルティ倍率 ×{presentation.multiplier}</span></div>}
      </div>}
      {presentation?.kind === 'penalty' && <div className="penalty-equation" aria-live="polite">
        {stage >= 2 && <span className="penalty-equation-value"><small>BASE</small>{presentation.basePenalty}</span>}
        {stage >= 3 && <><b>×</b><span className="penalty-equation-value"><small>MULTIPLIER</small>{presentation.multiplier}</span></>}
        {stage >= 4 && <><b>=</b><strong className="penalty-equation-value"><small>FINAL</small>{presentation.finalPenalty} pt</strong></>}
      </div>}
    </div>}
  </div>;
}
