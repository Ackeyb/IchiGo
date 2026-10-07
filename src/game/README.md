# Game engine

IchiGo v4のTurn、Round / Series進行、順位、Penaltyを扱う純粋なTypeScript domainです。

この層はReact、DOM、3D描画、音声、ストレージに依存しません。
ゲームルールの正本は [docs/SPEC.md](../../docs/SPEC.md) です。v4 / v3変更仕様書と過去STEP / auditは履歴資料です。

## API

- `createTurn({ turnId, totalCompletionCount, diceMode }, throwStyle?)`: 選択Modeの個数・0点で開始。Mode省略時は7、投げ方省略時は普通（1%）。
- `rollTurn(state, rollNumber, random, expectedTurnId, diceMode?, rollLimit?)`: 最新状態にROLL要求を適用し、新しい確定状態を返します。完走時は累積完走数も同時に1加算します。
- `continueTurn(state, rollNumber, expectedTurnId)`: 継続可能な結果を次ROLLの受付状態へ進めます。抽選しません。
- `resolveRoll(player, dice, diceMode?, rollNumber?, rollLimit?)`: 確定出目から得点・ダイス状態・継続／終了／完走を計算します。
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
UI接続・3D / 2D presentation・音・保存復旧は実装済みで、このdomainの外側が担当します。

## Ranking（ノーマル / 完走指定）

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

## Sudden Death / Round reset

- `shouldStartSuddenDeath(players)`: 2〜10人の全ターン終了後、全員完走、または全員非完走で得点・残数が一致する場合にtrue。
- `startSuddenDeath(state, expectedSuddenDeathCount)`: ノーマルの条件を満たしたラウンドを明示的にリセットします。判定だけでは開始しません。
- `resetFinishedRound(state, expectedSuddenDeathCount)`: 完走指定の次Roundにも使う全員reset。次Round eligibilityは`roundPolicy.ts`で判定し、Seriesには使いません。

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

## Penalty（ノーマル / 完走指定のsingle-roll）

- `createPenaltyState(round, penaltyId)`: 最終ラウンドの終了状態、元の全参加者一覧、確定済み累積完走数からペナルティ状態を生成します。
- `rollPenalty(state, playerId, random, expectedPenaltyId, diceMode?, throwStyle?)`: 固定順の次の未処理敗者だけを1回ROLLし、新しい確定状態を返します。
- `rollPenaltyDice(count, random, diceMode?, throwStyle?)`: 各dieでOUT判定を行い、SAFEの場合のみD6を生成する低水準関数です。
- `calculatePenalty(dice, totalCompletionCount, diceMode?)`: SAFEの出目と計算時のみ6換算するOUTから、BASE・倍率・FINALを計算し、die結果のコピーとともに返します。
- `getPenaltyMultiplier(totalCompletionCount)`: 既存の倍率計算をUI表示にも公開しています。

初期化時は既存Rankingから同率最下位全員を取得し、元の参加者一覧順に並べます。
全員のターン終了と参加者の整合性を検証し、サドンデス対象ラウンドは拒否します。
各敗者は元の参加者順で個別に1回ROLLします。通常PlayのROLL上限はPenaltyに適用しません。
ダイス数は敗者の確定残数（active + stranded）をコピーし、Dice Modeに応じて1〜14個を受け付けます。累積完走数も開始時の値を保持します。
各結果は `penalties` 内でプレイヤーIDに対応した `penaltyRoll / basePenalty / multiplier / finalPenalty` として保持します。
PenaltyのOUT確率は通常Playと同じthrowStyleを使います。各dieでOUT判定を先に行い、SAFEだけD6を生成します。
OUTの権威ある結果は `status: 'out', value: null` です。BASE計算時だけOUTを6として数え、保存・表示上のdie結果を6 faceに変換しません。
通常ROLLの得点解決処理は呼びません。ゲーム本編の状態は書き換えません。

`penaltyId`はゲームをまたいで再利用しないIDを指定し、要求には操作時点のIDを保持します。
ID不一致・重複・順番違い・敗者以外のROLL要求は同じ状態を返し、乱数を消費しません。
全員が `resolved` なら処理完了です。完了後のROLLも拒否します。
初期化関数は確定前の状態を作る関数なので、ペナルティ開始時に一度だけ呼び出してください。
呼び出し元は常に最新のPenaltyStateを渡し、戻り値を採用してから次の要求を処理します。
過去の状態を再入力することや、処理中に初期化し直すことを隠れた状態で検出する機能は持ちません。

`tests/game/penalty.test.ts` はSPEC §77の31〜34、1〜7個の合計、倍率×1/×2/×10、1/5の通常加算、元の順序、個別結果、二重確定防止、入力非変更、乱数境界を検証します。
`tests/game/penaltyOut.test.ts` と `tests/game/diceMode.test.ts` はthrowStyleごとのOUT、SAFEのみのD6生成、OUTの6換算とdie結果保持、14個の有効範囲および15個の拒否を検証します。

## Core Logic回帰テスト

`tests/game/audit.test.ts`でSPEC §77の29、2人・10人の複数ラウンドからペナルティまでの接続、
ターン／ペナルティIDの違う古い要求、累積値の一度だけの更新、欠損出目の拒否、
通常ROLLで到達する状態の不変条件を検証します。
過去の必須ケース対応表と監査結果は `docs/CORE_LOGIC_AUDIT.md` の履歴を参照してください。

## Flow / Setup / Recoveryとの境界

`gameFlow.ts`は既存エンジンを呼び出す純粋な進行制御です。得点・順位などのルールは再実装しません。
`advanceFlow(state, expectedRevision, action, random)`は古いリビジョンと不正なフェーズの要求を拒否します。
ゲーム開始／再開始でもリビジョンを戻さず、`gameNumber`を増やしてターンIDとペナルティIDの再利用を防ぎます。
ラウンドの現在プレイヤー状態と累積値は、ROLLが返した確定値から同じ遷移内で更新します。
ターン結果表示中は`result`を保持し、次の明示的なROLL操作でのみ`continueTurn`と`rollTurn`を呼びます。

`setup.ts`は保存可能なdraftの構造検証と、開始時のtrim後1〜12 graphemeの名前検証を分離します。draftでは空欄を許可し、どちらも2〜10人・一意な空でないID・有効なDice Mode／throwStyleを要求します。同名を許可します。
Reactとは独立してテスト可能です。UI側の操作ロックと描画完了通知は `src/app/gameStore.ts` が担当します。

準備系遷移は以下のように分離しています。

- `replay` はFinal Resultから`replayPreparation`へ移り、人物・ID・名前・順番・Game Modeと固有設定・Dice Mode・throwStyle・ROLL上限だけをdraftへ抽出します。
- `reorderReplay` は既存IDの完全な順列だけを受け付け、`startReplay`が明示されるまでgameplay stateを作りません。
- `newGame` はFinal Resultから設定を保持した通常Setup draftへ移ります。
- `exitGame` は進行中ゲームを従来の初期Setupへ戻し、Final Resultの`newGame`とは区別します。
- `fullReset` はSetup draftをノーマル・2人空欄・7 DICE・normal throw・ROLL ∞へ戻します。

Game Recovery schemaはversion 4で、進行中ゲームに加えてSetup／再戦準備draftを保存します。再戦準備は固定元構成も照合し、復旧データによる改名・設定変更を拒否します。schema 3を含む旧game snapshotはmigration / mode補完せずunsupportedとして拒否します。Seriesの進行 / 累積 / Penalty chunkはmode別validatorで照合し、修復しません。

SoundはFlow stateに含めず、game schemaとは独立したversion 1形式で保存します。Game Recoveryのschema更新や準備・reset遷移でSoundを初期化しません。

通常Setupはparticipant行ベースのUIです。人数は`participants.length`から派生し、追加・中間削除・上下移動・名前・Game Modeと固有設定・Dice Mode・throwStyle・ROLL上限の各変更を`updateSetup`経由でdraftへ即時反映します。Full Resetは確認Dialogを経て専用actionを送ります。

Replay Preparationは名前・Game Modeと固有設定・Dice Mode・throwStyle・ROLL上限を読み取り専用で表示し、既存IDの順序変更と明示的な`startReplay`だけを操作として公開します。

## ROLL上限とRecovery

正式仕様は `docs/SPEC.md` のROLL上限 / Recovery契約です。`RollLimit = null | 1 | 2 | 3 | 4 | 5` とし、nullは無制限・初期値です。設定の正本は編集時の`Setup.rollLimit`と開始後の`game.rollLimit`だけです。Player／Turnへコピーせず、使用回数は既存の`rollNumber`／`nextRollNumber`から導出します。

Flowは現在のROLL番号とゲームの上限をEngine／resolverへ明示的に渡します。上限超過の番号は抽選前に拒否し、結果確定後はCOMPLETE → no-score → ROLL上限 → activeDiceなし → 継続の順で判定します。`turnEnd`結果だけに`reason: noScore | rollLimit | noActiveDice`を保持します。上限に達してもそのROLLの得点・OUT・除外は確定します。Rankingは変更しません。

Sudden Death、Replay preparation、New GameはrollLimitを引き継ぎ、Full Resetはnullへ戻します。Game Recoveryはschema 4でmode / rollLimitを必須検証し、旧schemaを補完・移行せず拒否します。保存結果は同じROLL番号・上限で再解決し、最終ROLL終了後の`nextRollNumber = rollLimit + 1`も正当な状態です。Soundは独立したschema 1を維持します。

設定／表示UI・Three.js・Penalty OUTも実装済みで、上限とTurn進行の正本はdomainに置きます。`tests/game/rollLimit.test.ts`と`tests/storage/rollLimitRecovery.test.ts`で上限、優先順位、引継ぎ、乱数非消費、保存境界を検証します。

## Game Mode / Completion Target

`types.ts`の`GameMode`はnormal / completionTarget / seriesのdiscriminated unionです。`ModeConfiguration`はcompletionTargetとrollLimit=nullの相関を保証し、`isGameMode`はhidden mode設定を拒否します。`modeConfiguration`は設定だけを抽出し、進行stateをcarryしません。

`setup.ts`の`switchSetupMode`は別モードへの変更時にtarget=1 / gameCount=2を作り、同一mode再選択は元のdraftを保持します。完走指定へ入ると∞を強制し、離れても古い有限上限を戻しません。UIだけでなくdraft validatorもmodeと上限の整合を検証します。

`roundPolicy.ts`の`shouldStartNextRound`は全Turn終了後だけ、完走指定のtarget未達またはノーマルのSudden Death条件を判定します。途中到達は即終了ではありません。`totalCompletionCount`は同一playerの複数Round完走も数えるevent countで、targetを超えてよい。決着Roundだけを既存Ranking / single-roll Penaltyへ渡し、過去score / remainingを持ち越しません。

## Series / cumulative ranking

`series.ts`は`currentGameNumber`と元参加者順の`cumulative`を保持します。`commitSeriesGame`は最後のterminal ROLL遷移からだけ呼び、scoreとremaining（active+stranded）を一度だけ加算します。Completeのremaining寄与は0。`nextSeriesGame`は明示Intermediate actionで設定・累積値・completion countを保ち、current players / Turn / dice / ROLL番号をresetします。SeriesにSudden DeathやGame単位の勝敗 / Penaltyはありません。

`seriesRanking.ts`はcumulativeScore降順 → cumulativeRemainingDice昇順 → exact tieのcompetition ranking。Complete優先はなく、stable input orderingをtie-breakにしません。lowest rank全員を元順序で返し、全員同順位でも全員Penaltyです。

`seriesProvisional.ts`の`calculateSeriesProvisional`はvisible gameから、現Gameの終了済みTurnだけを順位対象にします。前Gameまでの累積 + 今回確定分を比較し、全員終了stateは既にatomic commit済みなので再加算しません。未終了playerは順位対象外。表示用derived値でありcumulative authorityを変更しません。

## Series Penalty / presentation boundary

`seriesPenalty.ts`は既存single-roll Penaltyと分離し、対象cumulativeRemainingDiceを0〜70で扱います。`partitionSeriesPenalty`は最大10個のplanを導出します。0個はresolved / BASE 0、ROLL・RNG・Renderer不要。`commitSeriesPenaltyChunk`はpenaltyId / playerId / chunkIndex / statusを抽選前に検証して1 requestで1 chunkをcommitし、OUT-check → SAFEのみface drawを維持します。OUT/nullは保存結果で、6換算は算術だけです。

authorityはpenaltyId、entries（playerId / totalDice / status / committedChunks / basePenalty）、currentLoserIndex。plan / next indexはderivedです。`seriesChunkBase`は累計更新とRecovery照合に使い、UIにchunk小計を表示するための契約ではありません。`seriesPenaltyResult`はresolved時だけ全BASEへcompletion count+1を一度適用してFINALを導出します。

domainはtimerを所有しません。`src/app/seriesPenaltyAutoCoordinator.ts`がreveal / paint acknowledgment後1500msで次chunk actionを送ります。Storeのrevisionとchunk identityを最新stateと照合し、stale requestはRNG前に拒否します。確認dialog中は停止し、取消後fresh wait。復旧runningも復元表示ack後fresh waitで自動再開し、pending次敗者は新たなuser tapが必要です。

`src/storage/sessionRecovery.ts`はschema 4でmode別進行、累積の到達可能範囲、phase、chunk prefix / status、BASE一致を検証し、過去Gameの推測repair・committed chunk再抽選 / 再加算を行いません。timer / ack / 残りmsは保存しません。Sound schema 1は独立です。

2D Series Penaltyは元Dice Modeと独立の最大5列chunk配置、Renderer入力は現在chunk最大10個です。通常PlayのDice Mode配置とThree.js stagingを変更しません。running UIは累計BASE、resolved後は倍率 / FINALを表示し、chunk BASE小計・式末尾小計は非表示。Rule PageはUI navigationでdomain phaseを追加せず、draft / RNG / Recoveryを変更しません。
