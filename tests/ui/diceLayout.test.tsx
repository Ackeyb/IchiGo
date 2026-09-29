// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DiceView } from '../../src/app/DiceView';
import { getDiceGridLayout } from '../../src/app/diceLayout';
import type { DieResult, DieValue } from '../../src/game/types';

afterEach(cleanup);

describe('dice result layout', () => {
  it.each([
    [5, 5, [5], 5],
    [7, 7, [7], 7],
    [10, 10, [5, 5], 5],
    [10, 9, [5, 4], 5],
    [10, 8, [5, 3], 5],
    [10, 7, [5, 2], 5],
    [10, 6, [5, 1], 5],
    [10, 5, [5], 5],
    [10, 4, [4], 4],
  ] as const)('%s DICE with %s results uses rows %j', (mode, count, rows, columns) => {
    expect(getDiceGridLayout(mode, count)).toMatchObject({ rows, columns });
  });

  it('distinguishes seven results in 7 DICE and 10 DICE', () => {
    expect(getDiceGridLayout(7, 7).rows).toEqual([7]);
    expect(getDiceGridLayout(10, 7).rows).toEqual([5, 2]);
  });
});

describe('2D dice faces', () => {
  const dice = ([1, 2, 3, 4, 5, 6] as const).map((value): DieResult => ({ status: 'safe', value }));

  it('uses the red face treatment only for faces 1 and 5', () => {
    render(<DiceView dice={dice} diceMode={7} kind="normal" />);
    for (const value of [1, 5] as const) {
      expect(screen.getByLabelText(`出目 ${value}、GET`).querySelector('.die-face-accent')).toBeTruthy();
    }
    for (const value of [2, 3, 4, 6] as readonly DieValue[]) {
      expect(screen.getByLabelText(`出目 ${value}、SAFE`).querySelector('.die-face-accent')).toBeNull();
    }
  });

  it('keeps 1 and 5 red in penalty presentation without status labels', () => {
    render(<DiceView dice={dice} diceMode={10} kind="penalty" />);
    const list = screen.getByRole('list', { name: '確定したダイスの出目' });
    expect(within(list).queryByText('SAFE')).toBeNull();
    expect(within(list).queryByText('GET')).toBeNull();
    expect(within(list).queryByText('OUT')).toBeNull();
    expect(screen.getByLabelText('出目 1').querySelector('.die-face-accent')).toBeTruthy();
    expect(screen.getByLabelText('出目 5').querySelector('.die-face-accent')).toBeTruthy();
  });

  it('retains normal-roll status text', () => {
    render(<DiceView dice={[{ status: 'safe', value: 1 }, { status: 'safe', value: 2 }, { status: 'out', value: null }]}
      diceMode={5} kind="normal" />);
    expect(screen.getByText('GET')).toBeTruthy();
    expect(screen.getByText('SAFE')).toBeTruthy();
    expect(screen.getByText('OUT')).toBeTruthy();
  });
});
