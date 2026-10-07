// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { createGameStore } from '../../src/app/gameStore';
import { RulesScreen } from '../../src/app/RulesScreen';
import { SessionRecovery } from '../../src/storage/sessionRecovery';
import type { StorageAdapter } from '../../src/storage/sessionRecovery';

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, string>();
  writes = 0;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes++; this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Rules Page', () => {
  it('opens from Setup and returns to the unchanged Series draft without writes or random draws', async () => {
    const storage = new MemoryStorage();
    const draws = vi.fn(() => 0.5);
    const recovery = new SessionRecovery(() => storage);
    const store = createGameStore({ next: draws }, recovery);
    render(<App store={store} soundPlayer={{ play: () => undefined, dispose: () => undefined }} />);

    fireEvent.change(screen.getByLabelText('プレイヤー 1', { exact: true }), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('プレイヤー 2', { exact: true }), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'プレイヤー追加' }));
    fireEvent.change(screen.getByLabelText('プレイヤー 3', { exact: true }), { target: { value: 'C' } });
    fireEvent.click(screen.getByRole('button', { name: 'プレイヤー追加' }));
    fireEvent.click(screen.getByLabelText('連続試合'));
    fireEvent.click(screen.getByLabelText('試合数 5'));
    fireEvent.click(screen.getByLabelText('14 DICE'));
    fireEvent.click(screen.getByLabelText('丁寧'));
    fireEvent.click(screen.getByLabelText('ROLL上限 3回'));

    const before = store.getSnapshot().state;
    if (before.phase !== 'setup') throw new Error('Expected Setup');
    const writesBefore = storage.writes;
    expect(before.draft.participants).toHaveLength(4);
    expect(before.draft.participants[3]?.name).toBe('');
    expect(before.draft).toMatchObject({ mode: { type: 'series', gameCount: 5 }, diceMode: 14, throwStyle: 'careful', rollLimit: 3 });

    const rulesButton = screen.getByRole('button', { name: 'ルール説明' });
    const soundButton = screen.getByRole('button', { name: 'サウンド ON' });
    expect(screen.getAllByRole('button', { name: 'ルール説明' })).toHaveLength(1);
    expect(rulesButton.closest('.site-header')).toBeTruthy();
    expect(rulesButton.compareDocumentPosition(soundButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ゲームの準備' }).closest('form')?.contains(rulesButton)).toBe(false);

    fireEvent.click(rulesButton);
    expect(screen.getByRole('heading', { name: 'ルール説明' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '戻る' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ゲーム開始|ROLL|Penalty/ })).toBeNull();
    expect(store.getSnapshot().state).toBe(before);
    expect(storage.writes).toBe(writesBefore);
    expect(draws).not.toHaveBeenCalled();

    const user = userEvent.setup();
    screen.getByRole('button', { name: '戻る' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('group', { name: '試合数' })).toBeTruthy();
    expect((screen.getByLabelText('試合数 5') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('14 DICE') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('丁寧') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('ROLL上限 3回') as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual(['A', 'B', 'C', '']);
    expect(store.getSnapshot().state).toBe(before);
    expect(storage.writes).toBe(writesBefore);
    expect(draws).not.toHaveBeenCalled();
  });

  it('preserves a Completion Target draft and its unlimited setting while navigating', () => {
    const store = createGameStore({ next: () => { throw new Error('Unexpected draw'); } });
    render(<App store={store} soundPlayer={{ play: () => undefined, dispose: () => undefined }} />);
    fireEvent.click(screen.getByLabelText('完走指定'));
    fireEvent.click(screen.getByLabelText('最低完走者数 4'));
    const before = store.getSnapshot().state;
    fireEvent.click(screen.getByRole('button', { name: 'ルール説明' }));
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.getByRole('heading', { name: 'ゲームの準備' })).toBeTruthy();
    expect((screen.getByLabelText('完走指定') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('最低完走者数 4') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('group', { name: 'ROLL上限' })).toBeNull();
    expect(store.getSnapshot().state).toBe(before);
  });

  it('keeps Sound toggle and persistence available beside the Setup rules button', () => {
    const storage = new MemoryStorage();
    const recovery = new SessionRecovery(() => storage);
    render(<App store={createGameStore({ next: () => { throw new Error('Unexpected draw'); } }, recovery)} recovery={recovery} soundPlayer={{ play: () => undefined, dispose: () => undefined }} />);
    const soundButton = screen.getByRole('button', { name: 'サウンド ON' });
    const rulesButton = screen.getByRole('button', { name: 'ルール説明' });
    expect(rulesButton.compareDocumentPosition(soundButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(soundButton);
    expect(screen.getByRole('button', { name: 'サウンド OFF' }).getAttribute('aria-pressed')).toBe('false');
    expect(recovery.loadSound().enabled).toBe(false);
  });

  it('explains the player-facing rules by mode and exposes semantic headings', () => {
    render(<RulesScreen onBack={() => undefined} />);
    for (const heading of ['基本ルール', 'ゲーム設定', 'ノーマル', '完走指定', '連続試合', 'Penalty（ペナルティポイント）']) {
      expect(screen.getByRole('heading', { name: heading, level: 3 })).toBeTruthy();
    }
    expect(screen.getByText(/1は100点、5は50点/)).toBeTruthy();
    expect(screen.getByText(/目標に達した瞬間には終了しません/)).toBeTruthy();
    expect(screen.getByText(/完走回数はRoundをまたいで累積/)).toBeTruthy();
    expect(screen.getByText(/最大70個/)).toBeTruthy();
    expect(screen.getByText(/各PenaltyのBASEを合計してから/)).toBeTruthy();
    expect(screen.queryByText(/authoritative|revision|schema|RandomSource|Recovery validator|chunk authority/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /ゲーム開始|ROLL|ペナルティROLL/ })).toBeNull();
  });
});
