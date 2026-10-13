# Playable UI — v6 current implementation

main / 02ce541のv6機能は実装済み。実機通しプレイ・実Rendererの視覚確認・その他ユーザー自身の最終プレイ確認・Human Push判断は残件。本書は現行UIの接続契約を説明する。正式仕様は[SPEC](SPEC.md)、現在の保守フローと過去STEP記録は[実装進行ガイド](../実装進行ガイド.md)。

## Current: v6

## フロー

ノーマル: Setup → 通常ターン →「次へ」→ 次プレイヤー →「結果を見る」→ FINAL RANKING。

- 全員完走または全員non-completeでscore / remaining完全一致:「サドンデスへ」→ SUDDEN DEATH →「開始」→ 全員で新ラウンド。
- 決着あり:「敗者発表」→ LOSER REVEAL →「ペナルティへ」→ 各敗者の個別ROLL。
- 各結果を確認して「次の敗者へ」。最後は「最終結果を見る」→ FINAL RESULT。
- 最終結果から「同じメンバーでもう一度」は確認後にReplay Preparationへ進み、順番だけを変更して明示的に再戦を開始する。「新しいゲーム」は前ゲームの人物・internal ID・名前・順番・Game Modeと固有設定・Dice Mode・投げ方・ROLL上限を引き継いだ編集可能なSetupへ進む。
- ゲーム中の「ゲームを終了する」も確認後に初期Setupへ戻る。

継続ROLL、次プレイヤー、次Round / Series Game、各敗者の初回Penalty ROLLは明示的なユーザー操作。Series / Zero-One Penaltyの後続chunkだけはpresentation complete後1500msを経て自動進行する。
描画完了は確定結果のrevealと操作ロック解除を行う。後続chunkはcoordinatorが別のguarded actionを送る。描画側で既存resultを再計算しない。

## 状態と接続契約

完走指定は全員Turn終了と最後のROLL presentation完了後、target未達なら「次の試合へ」でPlayから通常次Gameへ直接進む。全員Complete / 全員non-complete完全同率でも未達を優先し、Sudden Deathとは呼ばない。target達成後だけ同条件を評価し、真のSudden Deathなら「サドンデスへ」でfresh Gameへ直接進む。どちらも途中結果 / SUDDEN DEATH開始画面を挟まない。target達成 + Sudden Death不要なら「結果を見る」で現在GameのFINAL RANKING以降をノーマルと共用する。途中到達では全員Turn終了まで続け、countはtargetを超えてよい。

連続試合はSetup → Game 1 → 最後のROLL presentation完了 →「次の試合へ」→次Game。非最終GameはIntermediateを標準Flowでbypassする。Intermediate component / helper / phase / Recovery経路は将来の途中結果表示等への再利用余地として保持し、showIntermediateResults等のoptionは未実装。保持された画面は元順序で累積値を表示し、勝敗を確定しない。最終Gameは「結果を見る」→連続試合 FINAL RANKING →「ペナルティへ」→ Series Penalty →「最終結果を見る」→連続試合 FINAL RESULT。Sudden Deathと個別GameのPenaltyはない。

- `src/game/gameFlow.ts`: フェーズの可否確認と既存Engine呼び出し。React・DOMに依存しない。
- `src/app/gameStore.ts`: 最新のauthoritative stateを所有。Reactのrender、effect、state updater内では乱数を消費しない。
- `visibleState`は最後にreveal済みのauthoritative stateへの参照であり、ゲームルールのSource of Truthではない。ROLL commitからpresentation完了までは直前の表示だけを維持する。
- 各イベントは表示時の`revision`を保持する。古いイベントは最新状態へ適用せず、乱数も消費しない。
- 同じストア内でゲーム番号とrevisionを巻き戻さない。turnIdはゲーム番号・ラウンド番号・プレイヤーID、penaltyIdはゲーム番号から作る。
- ROLLのplayerと累積完走数は既存Engineの戻り値をそのまま同じ遷移で採用する。
  Reactで得点、残数、順位、サドンデス条件、倍率、ペナルティを再計算しない。
- 遷移開始時に同期ロックする。ダイス停止後に同じrevisionの結果をrevealし、確定状態が描画された後のフレームで解除する。ロック中は最新revisionでも次の操作を拒否。
  古い描画完了通知は解除に使わない。ダブルクリックの2回目とキーリピートも抑止する。
- Setupの人数・名前・順番・Game Modeと固有設定・Dice Mode・投げ方・ROLL上限は開始後の画面から編集できない。Replay Preparationでは順番だけを変更できる。

## 表示とアクセシビリティ

`DiceView`は確定済み`DieResult[]`の表示専用。通常ROLLではOUT／SAFE／GETを文字でも区別し、PenaltyのSAFEにはSAFE/GET labelを表示せず、OUTは専用文字・読み上げを維持する。投げ方は名称だけを表示し、具体的なOUT確率はUIへ表示しない。
直前の出目と現在ROLL可能な個数を分けて表示し、OUTを再ROLL候補に見せない。
通常ROLLと全Penaltyのface 1 / 5は赤いpipで表示するが、GET判定とは分離する。通常Play / single-roll Penaltyの結果カードは5 / 7 DICEで1行、10 DICEで最大5列、14 DICEで最大7列とし、Dice Modeと表示個数の両方から配置を決める。
`DicePresentation`は同じ確定結果を3D Rendererへ渡し、`DiceView`を常に文字情報と2D fallbackとして維持する。

名前は`Intl.Segmenter`でgrapheme単位に検証。ラベル・入力エラー・disabled状態を付与。
画面／結果の更新後は見出しへフォーカスし、Tabで主操作へ進める。
確認ダイアログはネイティブのmodal dialogを使用し、Tab循環・Escape取消・起点へのフォーカス復帰を行う。

## 3D Dice接続

依存方向はGame Engine → committed `DieResult[]` → `DicePresentationController` → `DiceRenderer`。
Three.jsはdynamic importし、RendererからEngineへ結果を返さない。通常ROLLとPenalty（Series / Zero-Oneは現在chunk）は、Engineが確定した配列順と値をそのまま表示する。

- SAFEは複数回バウンドしながら指定面を上にする最終quaternionへ収束させる。OUTは数値面を持たない専用色で盤面を転がり、縁を越えて重力落下する。
- `DiceRenderer`は`initialize / present / clear / dispose`を持ち、同一request IDを重複実行しない。
- 3D完了通知は表示時のrevisionで`gameStore.reveal`へ渡し、結果描画後に`gameStore.presented`でロック解除する。古い通知では新しい結果のrevealもbusy解除もできない。
- dynamic import、WebGL初期化、presentation、timeout、context lossの失敗時は、抽選を繰り返さず同じ確定結果を2D表示する。
- `prefers-reduced-motion: reduce`ではThree.jsを初期化せず2D表示する。
- RendererはROLL間でcanvas、scene、camera、geometry、material、textureを再利用する。停止後は連続描画せず、破棄時にRAF、observer、listener、GPU resourceを解放する。

## Result Animation / Sound

ダイス停止後の結果表示は`DicePresentation`が段階制御する。通常ROLLはGETダイスの強調、今回得点、結果種別の順、single-roll Penaltyは配列順の計算式（OUTはOUT(6)）とBASE、MULTIPLIER、FINALの順で表示し、その後に同じrevisionの`visibleState`をrevealして操作ロックを解除する。段階表示は確定済みEngine結果だけを参照し、得点・OUT・完走数・倍率を再計算しない。

- 1 / 5は出目、得点ラベル、outline、pulseで識別し、OUTには得点演出を適用しない。
- NO SCORE / TURN END、COMPLETE、Sudden Death、Loser Reveal、Penaltyの意味は文字でも表示する。
- SoundはWeb Audio APIで短い効果音を生成するPresentation専用サブシステム。初期値はONで、同じタブ内のゲーム遷移を跨いで設定を維持する。
- AudioContextの生成・resume・再生・破棄失敗はすべてfail-openとし、ゲーム進行やrevealを待たせない。
- `prefers-reduced-motion: reduce`では3Dと段階待機を省略し、確定結果を2Dとテキストで即時に提示する。

## Session Recovery

`src/storage/sessionRecovery.ts`が`sessionStorage`との境界、game/draft schema version 6の保存形式、復旧validationを担当する。`gameStore`はEngineまたはFlowが返した次のauthoritative state / draftをまずmemoryへcommitし、その直後に保存を試みてからsubscriberへ通知する。保存成否はゲームルール、Presentation、interaction unlockへ影響させない。

- ゲーム中はauthoritative `FlowState`、Setup / Replay Preparationでは現在のdraftを保存する。`visibleState`、busy、animation stage、Three.js resource、Promise、timer、RAF、AudioContextは保存しない。
- reload時は保存済みstateを`visibleState`にも設定し、busy=falseで開始する。確定済みROLL／Penaltyを再抽選せず、次の有効な操作から再開する。Series / Zero-One Penaltyのrunningだけは復元表示のpaint acknowledgment後fresh 1500msで次未実行chunkを自動再開する。pending loserは自動開始しない。完走指定の終端Playは未達の次Game / 達成後の真のSudden Death / 決着結果待ちを区別する。非最終SeriesはPlayの「次の試合へ」待ちを復元し、累積を再加算しない。最終SeriesはPlayのmaskを維持し、Final Rankingで実値を表示する。
- プレイヤー数・ID・順序、Game Modeと固有設定・Dice Mode・ROLL上限、ダイス不変条件、得点・完走、手番、phase、累積完走数、turnId・roll番号、penaltyId・計算結果を検証する。不正値は補正せず破棄し、schema 5以下の旧game saveはmigrationなしで拒否し、mode / ROLL ∞ / continuation identityを推測補完しない。schema 5以下 → 6 migrationは行わない。
- `newGame`は設定を引き継いだ編集可能なSetup draft、`replay`は順序だけ変更できるPreparation draft、`fullReset`はノーマル・2人・空欄・7 DICE・normal・ROLL ∞のSetup draftを保存する。
- Sound設定はschema 1でゲームstateと別キーに保存し、reload後も同一タブ内で維持する。
- access／read／write／remove失敗時は非侵襲的な警告を表示し、memory-onlyでゲームを継続する。

## 検証と範囲

- 既存テストを維持し、reveal timing、古いrevision、OUT落下軌道、段階的な得点／Penalty表示、Sound設定とfail-openを検証する。
- 決定論的RandomSourceで、2人・10人、継続、完走、暫定順位、連続サドンデス、複数敗者、個別Penalty、再プレイ／初期Setup、重複操作を検証。
- React StrictModeでも抽選が重複しないことと、キーボード操作・ダイアログのフォーカスを検証。
- Chromium実ブラウザーでSetup、通常ROLL、Penalty、Final Result、Replay Preparation、Recoveryとダイアログを確認。320 / 375 / 390 / 430 / 768pxおよびdesktop相当で横はみ出し・重なりがないことを検証する。
- ブラウザー確認用の生成物は`output/playwright/`に置き、コミットしない。

振動・シェイク操作は対象外。
v6の最終通しプレイQA・OUT実画面目視・最終Push判断は人間が行う。追加AI最終監査を必須工程にしない。v1当時の監査は履歴資料FINAL_AUDITを参照する。

## Responsive / Final UI Polish

単一のレスポンシブUIを維持し、320pxからdesktopまで、Setup・ゲーム本編・順位・サドンデス・敗者発表・Penalty・最終結果・確認dialogが横にはみ出さない構成とする。主要ボタンと並べ替え操作は44px以上のタップ領域を持ち、端末のsafe areaはviewportとページ余白で確保する。

- 狭幅ではダイス領域の高さ、カード余白、数値表示を圧縮しつつ、5 / 7 DICEは最大個数を横1行、10 DICEは最大5列、14 DICEは最大7列で表示する。通常ROLLのSAFE / GET / OUTラベルを読める大きさにし、Presentation領域はROLL前から必要高を確保してページ高の変動を抑える。
- 順位行はrank・名前／状態・score／残りを分け、狭幅ではscore情報を次段へ送る。完走・現在手番・暫定最下位は文字と枠／背景を併用する。
- Penaltyは確定値を再計算せず、既存のBASE・MULTIPLIER・FINALを数式として読み取れる配置にする。
- reduced motion、2D fallback、Sound OFF、Recovery通知でも同じ情報と操作を維持する。

## Setup / Replay / Reset

Setupは2〜10人のparticipant行を正とし、追加・中間削除・並べ替え・名前・Game Modeと固有設定・Dice Mode 5 / 7 / 10 / 14・throwStyle・ROLL上限を編集する。IDを維持しdraft変更を保存する。「ROLL上限」のvisible optionsは∞ / 1 / 2 / 3 / 4 / 5、default∞。

Game Modeはプレイヤー設定の下にノーマル（default） / 完走指定 / 連続試合 / ゼロワンを配置する。完走指定だけ「最低完走者数」1〜5、連続試合だけ「試合数」2〜5を表示する。モード切替は完走指定target=1、連続試合gameCount=2へresetし、同一mode再選択は現在値を維持する。非選択modeのhidden設定は保持しない。完走指定はROLL∞固定でROLL上限fieldset自体を非表示にし、離れた後も以前の有限値を復活させない。

Replay Preparationは人物・ID・名前・Game Modeと固有設定・Dice Mode・throwStyle・ROLL上限を固定し、順番だけ変更して明示開始する。有限は「ROLL 3回」等、無制限は「ROLL ∞」。New Gameはこれらを引き継いだ編集可能Setup。Full Resetは確認後ノーマル・2人・空欄・初期順・7 DICE・normal・ROLL ∞へ戻り、Soundを維持する。

ゼロワンはpreset 350 / 500 / 700 / 1000と投げ方を表示し、Dice Mode selector / ROLL上限fieldsetは非表示。default 500 / 7 DICE、別modeから戻るとdefault、同一mode再選択は現在presetを維持する。Replayはmode / preset / derived Dice Count / Throw Style固定でorderのみ変更可、全進行をresetする。New Gameはこれらをeditable Setupへcarryし、Full Resetは上記Normal defaultsへ戻る。ゼロワンのReplayではpreset / derived Dice Count / Throw Styleを表示し、ROLL上限表示は置かない。

## ROLL counter / Turn End（ノーマル / 完走指定 / 連続試合）

有限時のみPLAYERと同じ`.player-roll-line`内の`.roll-counter`へROLL n/limitを表示する。PLAYER行を折り返さずAction位置を維持する。∞ではcounter DOMを置かない。

番号は「次に振るROLLが何投目か」。limit 3：turn startで1/3 → 1投目animation・結果演出中も1/3 → 継続可能で2/3 → 2投目演出中も2/3 → 継続可能で3/3 → 3投目演出中も3/3 → 終了後非表示。押下直後に次番号へ進めない。

Engineの終了優先順位はCOMPLETE > no-score > ROLL上限 > no-active-dice > continuation。UIはauthoritative outcome/reasonを表示する。rollLimit理由にはTURN ENDと「ROLL上限に到達しました」を既存turn-message内に表示し、no-scoreには上限メッセージを出さない。

## Dice Mode別結果カード

| Dice Mode | 全モード通常Play / ノーマル・完走指定Penalty |
| --- | --- |
| 5 / 7 DICE | 1行 |
| 10 DICE | 10→5+5、9→5+4、8→5+3、7→5+2、6→5+1、5以下→1行 |
| 14 DICE | 14→7+7、13→7+6、12→7+5、11→7+4、10→7+3、9→7+2、8→7+1、7以下→1行 |

ゼロワン通常Playもpreset由来のDice Modeでこの表を適用する。

2D結果カードとThree.js animationの物理配置は別仕様。Three.jsへ厳密7+7を要求しない。

## Penalty OUT / Recovery

通常Playと同じthrowStyleでOUT判定後、SAFEだけD6生成する。ノーマル / 完走指定のPenaltyは各敗者1回、最大14個で、通常PlayのROLL上限対象外。OUTは同じ3D場外演出・2D OUT表示を使い、6 faceに置換しない。SAFEの1/5は赤いfaceだが特殊得点なし。

式は確定配列順にOUT(6) + 2 + 5 + OUT(6) = 19等を表示し、BASE × MULTIPLIER = FINALへ進む。OUTを別集計・並べ替えしない。

Recoveryは保存した上限・ターン進行・終了理由を復元し、reload前のROLL 2/3を維持する。最終許可ROLLの終了stateも受け入れる。Penalty OUTはstatus out / value nullを復元し、再抽選・face再生成・RandomSource再消費・Penalty再ROLLをしない。

## Mobile Stable Layout契約

320x568 / 375x667 / 390x844 / 430x932で、PlayのPLAYER n/n上端〜主要Action下端、PenaltyのPENALTY n/n上端〜主要Action下端が1 viewport内に収まる。

通常ROLL・続けてROLL・Penalty ROLL前後でscroll positionを勝手に動かさず、Actionを大きく移動させず、animation/result切替でlayout shiftを起こさない。同じターン内の結果focusはpreventScrollを使用する。

reserved presentation領域はidle時にも必要高を確保する安定性のための領域で、無駄な空白として消さない。READY・animation・status・Action Slotの構造を維持する。要素削除・統合・並べ替え、status/Action Slot移動、sticky/fixed/absolute Action hack、overflow隠蔽、animation短縮・touch target縮小で高さを稼がない。構造変更が必要なら人間判断へ戻す。reduced motion・2D fallback・Sound OFFでも同じ情報と操作を維持する。

## Three.js 14 DICE契約

Renderer最大14、15は拒否。11〜14はbalanced rowsと大個数用開始配置、狭いstageではcamera距離調整を使う。tray/dice寸法を維持し、小個数へ戻れば通常framingへ戻る。14個が自然に見えtray内で不自然にならず見切れないことが要件。

Rendererはpresentation-onlyでRandomSource非消費。SAFE face・OUT status・配列順はcommitted resultと一致する。resource再利用、resize再描画、context loss、timeout、cleanup、同じ結果の2D fallbackを維持する。

## Game Mode進捗 / Series暫定順位

PLAYERと同じ`.player-roll-line`に完走指定は「完走 current / target」、連続試合は「試合 current / total」を表示する。有限ROLL counterは連続試合でも共存する。進捗はvisibleStateを正とし、staged reveal前に新しい完走数等を先行表示しない。READY / animation / resultでreserved領域・Action位置を維持する。

ノーマル / 完走指定の暫定順位は現在Roundの終了済みTurnを従来どおり比較する。Seriesは現在Gameの終了済みTurnについて、過去Gameの累積値 + 現Gameの確定Turn分を比較する（累積score降順 → 累積remaining昇順 → exact tie、Complete優先なし）。未完了playerは未プレイ / プレイ中として順位対象外。最終playerのterminal ROLLで累積がatomic commitされた後は現Game分を二重加算しない。`RankingBoard`はvisibleStateを`calculateSeriesProvisional`へ渡す表示consumerであり、累積authorityを書き換えない。

最終Series Game開始直後から最後のplayerのTurn終了後まで、暫定順位・累計Scoreは「ヒミツ」、cumulativeRemainingDiceは表示、暫定最下位highlight / labelは非表示。元参加者順を保ち、行順から順位を漏らさない。内部のprovisional score / remaining / rank / bottom rank計算とvisibleStateの契約は維持し、現在playerのSCORE等の通常Turn情報は秘匿対象にしない。「結果を見る」後のFinal Rankingで実値を公開する。

## Series Penalty / auto coordinator

敗者のcumulativeRemainingDiceが対象（最大70）、正の個数は最大10個chunk。0個はROLL不要でBASE / FINAL 0、RNG・Rendererなし。各敗者の初回だけ「ペナルティROLL」、後続chunkは自動、次敗者は「次の敗者へ」後に新たな初回tapを必要とする。倍率は全chunkのBASE合計へtotalCompletionCount+1を一度だけ適用する。

running中は現在敗者・対象数・分割ROLL進捗・現在chunkの出目 / OUT・累計BASEを表示する。chunk BASE専用数値・小計・式末尾の小計を表示しない。内部chunk BASE計算は維持する。MULTIPLIER / FINAL値はrunning中は待機表示で、resolved後に合計BASE・倍率・ペナルティポイントを表示する。

現在chunkの2D配置は元Dice Modeとは独立に10→5+5、9→5+4、8→5+3、7→5+2、6→5+1、5以下1行。5 / 7 DICEでも10個chunkを表示でき、通常Playへこの規則を逆適用しない。Rendererには現在chunkだけを渡し、failure時も同じcommitted resultを2D表示する。

`seriesPenaltyAutoCoordinator`はcommit → save attempt → presentation → reveal / paint acknowledgment →1500ms wait → guarded next chunkを管理する。1 callbackで1 chunk。Store instance・revision・penalty / loser identity・committed chunk数を保持し、最新phase・busy・visibleStateと一致しないcallbackはRNG消費前に拒否する。timer / ack / pauseはpresentation-onlyで保存しない。

blocking confirmation OPENでtimer cancel、dialog中RNG消費・chunk commitなし、CANCELでfresh 1500ms、ACCEPTで終了して再開しない。disposeはtimer / subscriptionを解放する。復旧済みrunningは再演出 / rerollせず、復元結果のpaint acknowledgment後fresh 1500msで次未実行chunkへ進む。残りmsは復元せず追加tap不要。pending loserを自動開始しない。

Recoveryはmodeと固有設定、Seriesの試合番号・累積値・現Turn、Series Penaltyの対象敗者 / status / committedChunks / BASEを照合する。保存chunkからBASEを照合しても不一致は修復せず拒否する。確定chunk・OUT・累積値を再抽選 / 再加算しない。

## ルール説明 / Human QA

SetupヘッダーのSound左隣に「ルール説明」を配置し、最下部には置かない。`RulesScreen`はユーザー向けゲーム説明で、「戻る」で同じSetup draftへ戻る。AppのUI navigation stateとして管理し、Flow phase・game / participant stateを変更せず、Recovery write・RNG消費なし。既存各画面の説明も維持する。説明は完走指定の未達通常次Game / 達成後の真のSudden Death、Series途中試合の直接次Game / 最終試合の「ヒミツ」 / Final Ranking公開に合わせる。

Browser QAは320×568 / 375×667 / 390×844 / 430×932 / 768×1024 / 1280×900を対象とする。既存320×568の計測はPlay約567.81px、Normal Penalty約515.52px、Series Penalty約560.52px。v5確認ではPlay範囲約567.8125px・Action高56px、測定したROLL / continuation操作のscroll差0・Action位置差0。確認環境での実績で、全環境の寸法保証ではない。実機通しプレイ・実Rendererの視覚確認（OUTを含む）・その他ユーザー自身の最終プレイ確認・最終Push判断は残件。progressの折り返し、直接次Game、最終Seriesのmaskと公開、Action / scroll安定、auto chunk、fallback / reload、Rule Pageからdraft復帰を人間が確認する。

## ゼロワンPlay / Clear / Bust / Short

Setup → ゼロワンPlay。PLAYER行にpreset、metricsに残り点数 / active dice / 累積Turn数を表示する。1 ROLL = 1 Turnで、得点の有無・OUT・Bust・Short・Clearを問わず+1、同Turn内の「続けてROLL」はない。ROLL上限counterは使用しない。

出目 → 今回得点 → CLEAR / BUST / SHORT / TURN ENDのstaged presentationは確定resultだけを参照する。Bustでは点数・diceがROLL前へrollback済み、Shortではpreset点数 / full diceへreset済みでも、実際のrolled diceとoutcomeを表示する。commit → save attempt → presentation → reveal / paint acknowledgment → 次Actionを維持する。

Clearはちょうど残り0、Bustは超過、ShortはClear / Bustでない更新後remainingScore > activeDice × 100。Bust / ShortでもTurn数を戻さず、同RoundのClean Clear資格はfalse。Short resetで資格を復活させない。初回 / fresh GameとSudden Death startはtrue、獲得済みClean Clear累計はSDで維持する。本編OUTは0点・out/null、Penaltyの算術6換算と区別する。

original orderで未Clearだけを巡回し、結果完了後「次へ」で次Turn。進行一覧はClear / Turn数を示し、未ClearのFinal Rankは未確定。全員Clear後、累積Turn数全員同じなら「サドンデスへ」でfresh Round、差があれば「結果を見る」でFINAL RANKING。順位は累積Turn数昇順のcompetition rankingで実時間順を使わない。SDは点数 / dice / Clearをresetし、Turn数とClean Clear累計をcarry、全員の資格をtrueへ戻す。最後のClear演出を飛ばさない。

## ゼロワンPenalty / Recovery

FINAL RANKING →「ペナルティへ」→ shared分割Penalty画面 →「最終結果を見る」→ FINAL RESULT。各loserの対象数はloserTurnCount - topTurnCount、preset diceを掛けず、Series最大70を適用しない。23個は10+10+3。各敗者の初回tap・後続1500ms自動・次敗者fresh tap・blocking confirmation・stale guardはSeriesと共通。

runningは敗者 / 対象数 / 分割ROLL進捗 / 現在chunk / OUT / 累計BASE。chunk小計や式末尾小計、FINAL値は非表示。resolved後にBASE合計 × (totalCleanClearCount + 1) = FINALを表示する。OUTは表示 / 保存でout/null、算術上のみ6。Rendererは現在chunk最大10、2Dは10→5+5〜6→5+1 / ≤5一行でpreset独立。同じcommitted resultのfallbackを維持する。

schema 6はpreset、各playerの点数 / dice / Turn数 / Clear / eligibility、global clean count、手番 / SD、確定before / dice / outcome / result.player、ranking、Penalty prefix / BASEを検証する。schema5以前、missing preset / Turn数 / eligibility、壊れたsnapshotは補完・migration・repairしない。Bustのrollback後 / Shortのreset後 / Clearの確定値を復元し、Turnやclean countを再加算しない。committed chunkをreroll / 再加算せず、runningは復元paint ack後fresh 1500msで再開、pending loserは自動開始しない。timer / 残りms / presentation stateは保存せず、Sound schema 1を維持する。

## ゼロワンRule Page / Stable Layout確認実績

SetupヘッダーのSound左隣の入口とdraft保持 / Recovery writeなし / RNGなしは共通。ユーザー向け説明はShort後にClean Clear資格が戻らないこと、SD開始で資格をrenewする一方countは累積すること、Penaltyは「最下位のターン数 - トップのターン数」でpreset diceを掛けないことに合わせる。

既存Play / Penaltyの主要DOM順序・reserved regions・READY / animation / status / Action Slot・staged revealをゼロワンでも維持する。sticky / fixed / absolute hack、overflow hidden、削除 / 統合 / 並べ替え、animation短縮、touch target縮小 / 極端なfont縮小は収容手段にしない。

v6実装時の確認実績は、mobile 4 viewportのROLL / 次ActionでAction位置差0・scroll差0、4 presets + 既存3 modes × 6 viewportsの42初期表示でhorizontal overflowなし。23-dice Penaltyの10+10+3進行と全6 viewportのPenalty Action / scroll差0を確認。320×568はPlay範囲567.8125px / Action高56px、Penalty範囲約560.515625px。確認環境の記録であり永久保証値ではない。

tablet / desktop PlayのAction位置差約5.19px・scroll差0はv4/v5でも見られるknown existing layout behaviorで、v6では変更していない。新しいv6 regressionとして扱わない。実機通しプレイ・実Renderer / OUT目視・その他Human final play QA・最終Human Push判断は残件。
