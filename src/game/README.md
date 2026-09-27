# Game engine

Phase 1の1人分の通常ターンを扱う純粋なTypeScriptエンジンです。

この層はReact、DOM、3D描画、音声、ストレージに依存しません。
ゲームルールの正本は `docs/SPEC.md` です。

## API

- `createTurn(throwStyle?)`: 7個・0点で開始。省略時は普通（3%）。
- `rollTurn(state, rollNumber, random)`: 最新状態にROLL要求を適用し、新しい確定状態を返します。
- `continueTurn(state, rollNumber)`: 継続可能な結果を次ROLLの受付状態へ進めます。抽選しません。
- `resolveRoll(player, dice)`: 確定出目から得点・ダイス状態・継続／終了／完走を計算します。
- `getRemainingDice(player)`: `activeDice + strandedDice`を返します。
- `rollGameDice(count, throwStyle, random)`: ダイスごとにOUTを先に判定し、SAFEだけD6を抽選します。

入力は変更しません。返された状態は読み取り専用として扱います。
乱数源は`RandomSource`で注入し、値域は有限な`[0, 1)`です。
本番用の`mathRandomSource`だけが`Math.random()`を呼び出します。

## 二重処理防止の境界

ROLL番号はターン内で1から増加します。受付中の番号と一致しない要求、
結果確認中や終了後の要求は同じ状態を返し、乱数を消費しません。
継続には直前のROLL番号が必要です。終了後の継続は拒否します。

呼び出し元は最新の状態を渡し、返された状態を次の要求の前に採用してください。
純粋関数なので、過去の状態を再び渡すこと自体を内部の隠れた状態で防ぐことはしません。
`resolveRoll`は計算用の低水準APIです。操作受付には`rollTurn`を使用します。

## テストと対象範囲

`tests/game/engine.test.ts`でSPEC §77の01〜17、35〜39を検証します。
乱数境界、不正入力、入力の非変更、16,384通りの初回ROLLの不変条件も確認します。

プレイヤーの完走状態は確定しますが、複数人・複数ラウンドの累積完走数管理は含めません。
Sudden Death、Penalty、UI接続、3D、演出、音、保存復旧は後続Phaseです。

## Ranking（STEP 4）

`ranking.ts` は `PlayerTurn` に一意な `id` を加えた入力から純粋に計算します。

- `comparePlayers(a, b)`: 完走優先、非完走者は得点降順・残数昇順。OUT内訳は比較しません。
- `calculateFinalRanking(players)`: 全員ターン終了を要求し、`rankings` と `loserIds` を返します。
- `calculateProvisionalRanking(players)`: `turnFinished === true` のみを対象に、`rankings` と `bottomIds` を返します。

順位は1224方式です。同率内の返却順は入力順を維持し、追加タイブレークにはしません。
入力配列やプレイヤーは変更せず、結果はIDと順位で返します。対象が空なら結果も空です。
人数・名前のセットアップ検証は行いませんが、順位対象のID重複と不正なダイス状態は拒否します。

`loserIds` は順位上の最下位集合です。全員同率なら全員が含まれます。
SPEC §29・30のサドンデス判定や敗者確定フェーズへの進行はこのモジュールでは実行しません。
後続のラウンド制御は、最下位集合をペナルティへ渡す前にサドンデス条件を扱う必要があります。

`tests/game/ranking.test.ts` でSPEC §77の18〜22・30と、暫定順位、2人・10人、入力非変更を検証します。
