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
Ranking、Sudden Death、Penalty、UI接続、3D、演出、音、保存復旧は後続Phaseです。
