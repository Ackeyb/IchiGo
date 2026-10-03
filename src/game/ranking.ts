import { assertPlayerTurn, getRemainingDice } from './rollResolver';
import { DEFAULT_DICE_MODE } from './types';
import type { DiceMode, PlayerTurn } from './types';

export type RankingPlayer = PlayerTurn & Readonly<{ id: string }>;
export type RankingEntry = Readonly<{ playerId: string; rank: number }>;
export type FinalRanking = Readonly<{
  rankings: readonly RankingEntry[];
  loserIds: readonly string[];
}>;
export type ProvisionalRanking = Readonly<{
  rankings: readonly RankingEntry[];
  bottomIds: readonly string[];
}>;

/** SPEC §24–27, §64. Equal players remain equal regardless of OUT breakdown. */
export function comparePlayers(a: PlayerTurn, b: PlayerTurn): number {
  if (a.completed && b.completed) return 0;
  if (a.completed) return -1;
  if (b.completed) return 1;
  return b.score - a.score || getRemainingDice(a) - getRemainingDice(b);
}

function rankFinishedPlayers(players: readonly RankingPlayer[], diceMode: DiceMode): readonly RankingEntry[] {
  const ids = new Set<string>();
  for (const player of players) {
    assertPlayerTurn(player, diceMode);
    if (ids.has(player.id)) throw new Error('Ranking requires unique player IDs.');
    ids.add(player.id);
  }
  // Copy before sorting; input order is stable within ties but is not a tiebreaker.
  // Ties share a competition rank and leave gaps in the following ranks.
  const sorted = [...players].sort(comparePlayers);
  let rank = 0;
  return sorted.map((player, index) => {
    const previous = sorted[index - 1];
    if (!previous || comparePlayers(previous, player) !== 0) rank = index + 1;
    return { playerId: player.id, rank };
  });
}

function lowestIds(rankings: readonly RankingEntry[]): readonly string[] {
  const lowestRank = rankings.at(-1)?.rank;
  return rankings.filter((entry) => entry.rank === lowestRank).map((entry) => entry.playerId);
}

/** Ranking only: round progression / sudden-death decisions belong to the caller. */
export function calculateFinalRanking(players: readonly RankingPlayer[], diceMode: DiceMode = DEFAULT_DICE_MODE): FinalRanking {
  if (players.some((player) => !player.turnFinished)) {
    throw new Error('Final ranking requires all turns to be finished.');
  }
  const rankings = rankFinishedPlayers(players, diceMode);
  return { rankings, loserIds: lowestIds(rankings) };
}

/** SPEC §39: exclude both unplayed and currently playing players. */
export function calculateProvisionalRanking(players: readonly RankingPlayer[], diceMode: DiceMode = DEFAULT_DICE_MODE): ProvisionalRanking {
  const rankings = rankFinishedPlayers(players.filter((player) => player.turnFinished), diceMode);
  return { rankings, bottomIds: lowestIds(rankings) };
}
