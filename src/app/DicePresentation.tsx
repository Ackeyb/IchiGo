import { useEffect, useRef, useState } from 'react';
import type { DieResult } from '../game/types';
import { DicePresentationController } from '../dice/presentationController';
import type {
  DicePresentationKind,
  DicePresentationOutcome,
  DiceRendererFactory,
} from '../dice/types';
import { DiceView } from './DiceView';

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
}>;

export function DicePresentation({
  dice,
  kind,
  revision,
  busy,
  onPresented,
  config,
}: {
  dice?: readonly DieResult[] | undefined;
  kind: DicePresentationKind;
  revision: number;
  busy: boolean;
  onPresented: (revision: number) => void;
  config?: DicePresentationConfig | undefined;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<DicePresentationController | undefined>(undefined);
  const [outcome, setOutcome] = useState<DicePresentationOutcome>();
  const createRenderer = config?.createRenderer ?? defaultRendererFactory;
  const timeoutMs = config?.timeoutMs;
  const prefersReducedMotion = config?.prefersReducedMotion;
  const requestId = `${kind}/${revision}`;

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
    if (!dice) {
      controller.current?.clear();
      setOutcome(undefined);
      return;
    }
    if (!busy || !controller.current) return;
    let current = true;
    let secondFrame = 0;
    let firstFrame = 0;
    setOutcome(undefined);
    const finish = (next: DicePresentationOutcome) => {
      if (!current) return;
      setOutcome(next);
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => onPresented(revision));
      });
    };
    const result = controller.current.present({ id: requestId, dice, kind });
    if (result instanceof Promise) void result.then(finish);
    else finish(result);
    return () => {
      current = false;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [busy, dice, kind, onPresented, requestId, revision]);

  const useThree = outcome?.mode !== 'fallback';
  return <div className={`dice-presentation ${dice ? '' : 'is-idle'} ${useThree ? 'use-three' : 'use-fallback'}`}>
    <div ref={container} className="three-dice-stage" aria-hidden="true" />
    {outcome?.mode === 'fallback' && <p className="renderer-status">{fallbackLabels[outcome.reason]}</p>}
    {dice && <div className="dice-result-details">
      <DiceView dice={dice} scoring={kind === 'normal'} />
    </div>}
  </div>;
}
