import { describe, expect, it } from 'vitest';
import { calculateFinalRanking, calculateProvisionalRanking, comparePlayers } from '../../src/game/ranking';
import type { RankingPlayer } from '../../src/game/ranking';
import { createTurn } from '../../src/game/gameEngine';
import { assertPlayerTurn, resolveRoll } from '../../src/game/rollResolver';

function player(id: string, score: number, remaining: number, stranded = 0): RankingPlayer {
  const result = {
    id, score, activeDice: remaining - stranded, strandedDice: stranded,
    removedDice: 7 - remaining, completed: remaining === 0, turnFinished: true,
  };
  assertPlayerTurn(result);
  return result;
}
const entry = (playerId: string, rank: number) => ({ playerId, rank });

describe('SPEC §77 cases 18–22 and 30: ranking and losers', () => {
  it('ranks all non-completers by score first, even with more remaining dice', () => {
    expect(calculateFinalRanking([player('low', 200, 3), player('high', 300, 4)])).toEqual({
      rankings: [entry('high', 1), entry('low', 2)], loserIds: ['low'],
    });
  });

  it('one completer outranks a higher-scoring non-completer', () => {
    expect(calculateFinalRanking([player('unfinished', 600, 1), player('complete', 350, 0)])).toEqual({
      rankings: [entry('complete', 1), entry('unfinished', 2)], loserIds: ['unfinished'],
    });
  });

  it('19: different completion scores share first; the next rank skips both (§99)', () => {
    expect(calculateFinalRanking([player('C', 600, 1), player('A', 350, 0), player('B', 600, 0)])).toEqual({
      rankings: [entry('A', 1), entry('B', 1), entry('C', 3)], loserIds: ['C'],
    });
  });

  it('20: tied scores use fewer remaining dice', () => {
    expect(calculateFinalRanking([player('more', 200, 5), player('less', 200, 3)]).rankings)
      .toEqual([entry('less', 1), entry('more', 2)]);
  });

  it('21: identical scores and remaining dice share rank', () => {
    expect(calculateFinalRanking([player('a', 200, 3), player('b', 200, 3)])).toEqual({
      rankings: [entry('a', 1), entry('b', 1)], loserIds: ['a', 'b'],
    });
  });

  it('18: OUT/active breakdown is not a tiebreaker in either comparison direction', () => {
    const a = player('a', 200, 3, 1);
    const b = player('b', 200, 3);
    expect(comparePlayers(a, b)).toBe(0);
    expect(comparePlayers(b, a)).toBe(0);
    expect(calculateFinalRanking([a, b]).rankings).toEqual([entry('a', 1), entry('b', 1)]);
    expect(calculateFinalRanking([b, a]).rankings).toEqual([entry('b', 1), entry('a', 1)]);
  });

  it('22/30: standard competition ranking is 1,2,2,4 with one loser', () => {
    expect(calculateFinalRanking([
      player('d', 0, 7), player('b', 200, 3), player('a', 300, 2), player('c', 200, 3, 2),
    ])).toEqual({
      rankings: [entry('a', 1), entry('b', 2), entry('c', 2), entry('d', 4)], loserIds: ['d'],
    });
  });

  it('22: every player tied for lowest rank is a loser', () => {
    expect(calculateFinalRanking([player('a', 300, 2), player('b', 100, 5), player('c', 100, 5, 2)])).toEqual({
      rankings: [entry('a', 1), entry('b', 2), entry('c', 2)], loserIds: ['b', 'c'],
    });
  });

  it('ranks ten players with multiple groups of ties and multiple completers', () => {
    const players = [
      player('a', 350, 0), player('b', 700, 0), player('c', 600, 1),
      player('d', 300, 2), player('e', 300, 2, 1), player('f', 300, 4),
      player('g', 100, 5), player('h', 100, 6), player('i', 0, 7), player('j', 0, 7, 7),
    ];
    expect(calculateFinalRanking(players)).toEqual({
      rankings: [entry('a', 1), entry('b', 1), entry('c', 3), entry('d', 4), entry('e', 4),
        entry('f', 6), entry('g', 7), entry('h', 8), entry('i', 9), entry('j', 9)],
      loserIds: ['i', 'j'],
    });
  });

  it('all completers tie regardless of score; this module does not advance rounds', () => {
    expect(calculateFinalRanking([player('a', 350, 0), player('b', 700, 0)]).rankings)
      .toEqual([entry('a', 1), entry('b', 1)]);
  });

  it('is deterministic and does not mutate frozen players or their input order', () => {
    const players = Object.freeze([Object.freeze(player('b', 100, 5)), Object.freeze(player('a', 200, 3))]);
    const before = structuredClone(players);
    expect(calculateFinalRanking(players)).toEqual(calculateFinalRanking(players));
    expect(players).toEqual(before);
    expect(players[0]).not.toHaveProperty('rank');
  });

  it('accepts Phase 1 resolved turn state without changing that engine', () => {
    const complete = resolveRoll(createTurn().player, Array.from({ length: 7 }, () => ({ status: 'safe' as const, value: 5 as const })));
    const ended = resolveRoll(createTurn().player, Array.from({ length: 7 }, () => ({ status: 'out' as const, value: null })));
    expect(calculateFinalRanking([{ ...ended.player, id: 'out' }, { ...complete.player, id: 'complete' }]).loserIds).toEqual(['out']);
  });
});

describe('SPEC §39: provisional ranking', () => {
  it('excludes both unplayed and in-progress players, even when their score is higher', () => {
    const unplayed = { ...createTurn().player, id: 'unplayed' };
    const playing = { ...player('playing', 600, 1), turnFinished: false };
    expect(calculateProvisionalRanking([unplayed, player('done', 100, 5), playing])).toEqual({
      rankings: [entry('done', 1)], bottomIds: ['done'],
    });
  });

  it('marks all tied provisional bottom players, including zero-score finished turns', () => {
    expect(calculateProvisionalRanking([
      player('a', 100, 5), player('b', 0, 7), { ...createTurn().player, id: 'new' }, player('c', 0, 7, 3),
    ])).toEqual({ rankings: [entry('a', 1), entry('b', 2), entry('c', 2)], bottomIds: ['b', 'c'] });
  });

  it('returns no rankings or bottom players before any turn ends', () => {
    expect(calculateProvisionalRanking([{ ...createTurn().player, id: 'a' }, { ...createTurn().player, id: 'b' }]))
      .toEqual({ rankings: [], bottomIds: [] });
  });

  it('uses completion priority and competition ranks for provisional results too', () => {
    expect(calculateProvisionalRanking([player('a', 350, 0), player('b', 700, 0), player('c', 600, 1)]))
      .toEqual({ rankings: [entry('a', 1), entry('b', 1), entry('c', 3)], bottomIds: ['c'] });
  });
});

describe('ranking API boundaries', () => {
  it('rejects final ranking before all turns finish', () => {
    expect(() => calculateFinalRanking([{ ...createTurn().player, id: 'a' }, player('b', 0, 7)]))
      .toThrow('all turns');
  });
  it('returns empty results for empty collections', () => {
    expect(calculateFinalRanking([])).toEqual({ rankings: [], loserIds: [] });
    expect(calculateProvisionalRanking([])).toEqual({ rankings: [], bottomIds: [] });
  });
  it('rejects duplicate IDs instead of merging participants', () => {
    expect(() => calculateFinalRanking([player('same', 100, 5), player('same', 200, 3)])).toThrow('unique');
  });
  it('uses IDs rather than names to identify players', () => {
    const players = [{ ...player('a', 100, 5), name: '同名' }, { ...player('b', 0, 7), name: '同名' }];
    expect(calculateFinalRanking(players).loserIds).toEqual(['b']);
  });
});
