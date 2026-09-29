# Game engine

Phase 1の1人分の通常ターンを扱う純粋なTypeScriptエンジンです。

この層はReact、DOM、3D描画、音声、ストレージに依存しません。
ゲームルールの正本は `docs/SPEC.md` です。

## API

- `createTurn({ turnId, totalCompletionCount, diceMode }, throwStyle?)`: 選択Modeの個数・0点で開始。Mode省略時は7、投げ方省略時は普通（1%）。
- `rollTurn(state, rollNumber, random, expectedTurnId, diceMode?)`: 最新状態にROLL要求を適用し、新しい確定状態を返します。完走時は累積完走数も同時に1加算します。
- `continueTurn(state, rollNumber, expectedTurnId)`: 継続可能な結果を次ROLLの受付状態へ進めます。抽選しません。
- `resolveRoll(player, dice, diceMode?)`: 確定出目から得点・ダイス状態・継続／終了／完走を計算します。
- `getRemainingDice(player)`: `activeDice + strandedDice`を返します。
- `rollGameDice(count, throwStyle, random, diceMode?)`: ダイスごとにOUTを先に判定し、SAFEだけD6を抽選します。

入力は変更しません。返された状態は読み取り専用として扱います。
乱数源は`RandomSource`で注入し、値域は有限な`[0, 1)`です。
本番用の`mathRandomSource`だけが`Math.random()`を呼び出します。

## 二重処理防止の境界

`turnId`は呼び出し元がゲーム・ラウンド・プレイヤーをまたいで再利用しないIDを指定します。
要求には操作時点のIDを保持し、適用時の最新状態のIDに置き換えないでください。
ROLL番号はターン内で1から増加します。ターンIDまたは受付中の番号と一致しない要求、
結果確認中や終了後の要求は同じ状態を返し、乱数を消費しません。
継続には直前のROLL番号が必要です。終了後の継続は拒否します。

呼び出し元は最新の状態を渡し、返された状態を次の要求の前に採用してください。
純粋関数なので、過去の状態を再び渡すこと自体を内部の隠れた状態で防ぐことはしません。
`resolveRoll`は計算用の低水準APIです。操作受付には`rollTurn`を使用します。

## テストと対象範囲

`tests/game/engine.test.ts`でSPEC §77の01〜17、35〜39を検証します。
乱数境界、不正入力、入力の非変更、16,384通りの初回ROLLの不変条件も確認します。

初回の累積完走数は0です。次プレイヤー・次ラウンドでは直前に確定した`totalCompletionCount`を
`createTurn`へ渡し、ROLLが返した累積値をラウンド状態へ採用してください。
完走数をUI側で再加算してはいけません。非完走・継続・拒否された要求では加算しません。
UI接続はSTEP 8で追加しています。3D、演出、音、保存復旧は後続Phaseです。

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

## Sudden Death（STEP 5）

- `shouldStartSuddenDeath(players)`: 2〜10人の全ターン終了後、全員完走、または全員非完走で得点・残数が一致する場合にtrue。
- `startSuddenDeath(state, expectedSuddenDeathCount)`: 条件を満たしたラウンドを明示的にリセットします。判定だけでは開始しません。

`SuddenDeathState.participants` はゲーム開始時に固定された全参加者のID・名前を元のプレイ順で保持する正本です。
`players` はIDに対応する現在ラウンドの状態です。両者のID集合が一致しない入力は拒否します。
リセットでは `participants` の順序から全員を再構築し、現在プレイヤー位置を先頭へ戻します。
引き継ぐフィールドだけを明示的に構築するため、古いrank・順位一覧・ROLL結果等は残りません。
新ラウンドのダイス状態は既存の `createTurn` を再利用します。

`totalCompletionCount` は呼び出し元ですでに確定された累積値をそのまま保持し、リセット時に再加算しません。
加算は`rollTurn`が行います。サドンデス開始前に、その戻り値をラウンド状態へ採用してください。
`throwStyle` を維持し、OUT確率は既存の対応表から導出します。
`suddenDeathCount` は開始成功時だけ1増加します。

開始要求には要求時点の `suddenDeathCount` を渡します。古い要求・未終了ラウンド・条件不成立は元の状態を返します。
呼び出し元は常に最新状態を渡し、戻り値を次の操作前に採用してください。
開始直後は全員 `turnFinished = false` となるため、同じラウンドの二重開始も拒否されます。

`tests/game/suddenDeath.test.ts` はSPEC §77の23〜28を対象に、2人・10人、OUT内訳差、全員参加、
順序、状態リセット、累積値保持、投げ方3種、連続開始、古い要求、入力非変更を検証します。

## Penalty（STEP 6）

- `createPenaltyState(round, penaltyId)`: 最終ラウンドの終了状態、元の全参加者一覧、確定済み累積完走数からペナルティ状態を生成します。
- `rollPenalty(state, playerId, random, expectedPenaltyId)`: 固定順の次の未処理敗者だけを1回ROLLし、新しい確定状態を返します。
- `rollPenaltyDice(count, random)`: OUT判定をせず、指定個数のD6用乱数だけを消費する低水準関数です。
- `calculatePenalty(dice, totalCompletionCount)`: 出目合計・倍率・最終ポイントを計算し、出目のコピーとともに返します。
- `getPenaltyMultiplier(totalCompletionCount)`: 既存の倍率計算をUI表示にも公開しています。

初期化時は既存Rankingから同率最下位全員を取得し、元の参加者一覧順に並べます。
全員のターン終了と参加者の整合性を検証し、サドンデス対象ラウンドは拒否します。
ダイス数は敗者の確定残数（active + stranded）をコピーし、累積完走数も開始時の値を保持します。
各結果は `penalties` 内でプレイヤーIDに対応した `penaltyRoll / basePenalty / multiplier / finalPenalty` として保持します。
通常ROLLの抽選・得点解決処理は呼びません。ゲーム本編の状態は書き換えません。

`penaltyId`はゲームをまたいで再利用しないIDを指定し、要求には操作時点のIDを保持します。
ID不一致・重複・順番違い・敗者以外のROLL要求は同じ状態を返し、乱数を消費しません。
全員が `resolved` なら処理完了です。完了後のROLLも拒否します。
初期化関数は確定前の状態を作る関数なので、ペナルティ開始時に一度だけ呼び出してください。
呼び出し元は常に最新のPenaltyStateを渡し、戻り値を採用してから次の要求を処理します。
過去の状態を再入力することや、処理中に初期化し直すことを隠れた状態で検出する機能は持ちません。

`tests/game/penalty.test.ts` はSPEC §77の31〜34、1〜7個の最小・最大合計、倍率×1/×2/×10、
OUTなし、1/5の通常加算、元の順序、個別結果、二重確定防止、入力非変更、乱数境界を検証します。

## Core Logic Audit（STEP 7）

`tests/game/audit.test.ts`でSPEC §77の29、2人・10人の複数ラウンドからペナルティまでの接続、
ターン／ペナルティIDの違う古い要求、累積値の一度だけの更新、欠損出目の拒否、
通常ROLLで到達する状態の不変条件を検証します。
必須ケースの対応表と監査結果は `docs/CORE_LOGIC_AUDIT.md` を参照してください。

## Playable UI（STEP 8）

`gameFlow.ts`は既存エンジンを呼び出す純粋な進行制御です。得点・順位などのルールは再実装しません。
`advanceFlow(state, expectedRevision, action, random)`は古いリビジョンと不正なフェーズの要求を拒否します。
ゲーム開始／再開始でもリビジョンを戻さず、`gameNumber`を増やしてターンIDとペナルティIDの再利用を防ぎます。
ラウンドの現在プレイヤー状態と累積値は、ROLLが返した確定値から同じ遷移内で更新します。
ターン結果表示中は`result`を保持し、次の明示的なROLL操作でのみ`continueTurn`と`rollTurn`を呼びます。

`setup.ts`は2〜10人・一意なID・trim後1〜12 graphemeの名前を検証します。同名を許可します。
Reactとは独立してテスト可能です。UI側の操作ロックと描画完了通知は `src/app/gameStore.ts` が担当します。

v2 STEP 2では準備系遷移を分離しています。

- `replay` はFinal Resultから`replayPreparation`へ移り、人物・ID・名前・順番・Dice Mode・throwStyleだけをdraftへ抽出します。
- `reorderReplay` は既存IDの完全な順列だけを受け付け、`startReplay`が明示されるまでgameplay stateを作りません。
- `newGame` はFinal Resultから設定を保持した通常Setup draftへ移ります。
- `exitGame` は進行中ゲームを従来の初期Setupへ戻し、Final Resultの`newGame`とは区別します。
- `fullReset` はSetup draftを2人空欄・7 DICE・normalへ戻します。

SoundはFlow stateに含めず、これらの遷移では変更しません。STEP 3までSetup／再戦draftはv1 Recoveryへ保存しません。
