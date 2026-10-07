# Playable UI — v4 current implementation

main / d7a5b3dのv4機能は実装済み。最終通しプレイQA・OUT実画面目視・Human Push判断は残件。本書は現行UIの接続契約を説明する。正式仕様は[SPEC](SPEC.md)、現在の保守フローと過去STEP記録は[実装進行ガイド](../実装進行ガイド.md)。

## Current: v4

## フロー

ノーマル: Setup → 通常ターン →「次へ」→ 次プレイヤー →「結果を見る」→ FINAL RANKING。

- 全員完走または全員non-completeでscore / remaining完全一致:「サドンデスへ」→ SUDDEN DEATH →「開始」→ 全員で新ラウンド。
- 決着あり:「敗者発表」→ LOSER REVEAL →「ペナルティへ」→ 各敗者の個別ROLL。
- 各結果を確認して「次の敗者へ」。最後は「最終結果を見る」→ FINAL RESULT。
- 最終結果から「同じメンバーでもう一度」は確認後にReplay Preparationへ進み、順番だけを変更して明示的に再戦を開始する。「新しいゲーム」は前ゲームの人物・internal ID・名前・順番・Game Modeと固有設定・Dice Mode・投げ方・ROLL上限を引き継いだ編集可能なSetupへ進む。
- ゲーム中の「ゲームを終了する」も確認後に初期Setupへ戻る。

継続ROLL、次プレイヤー、次Round / Series Game、各敗者の初回Penalty ROLLは明示的なユーザー操作。Series Penaltyの後続chunkだけはpresentation complete後1500msを経て自動進行する。
描画完了は確定結果のrevealと操作ロック解除を行う。後続chunkはcoordinatorが別のguarded actionを送る。描画側で既存resultを再計算しない。

## 状態と接続契約

完走指定はRound全員終了後の「結果を見る」で目標未達またはSudden Death条件ならSUDDEN DEATHへ直接進み、「開始」で全員の次Roundを始める。途中のtarget到達ではTurnを打ち切らない。決着時は現在RoundのFINAL RANKING以降をノーマルと共用する。

連続試合はSetup → Game 1 →「結果を見る」→「試合 x / y 終了」（Intermediate）→「次の試合へ」→次Game。Intermediateは元順序で累積スコア・残ダイスを表示し、勝敗を確定しない。最終Game後は連続試合 FINAL RANKING →「ペナルティへ」→ Series Penalty →「最終結果を見る」→連続試合 FINAL RESULT。Sudden Deathと個別GameのPenaltyはない。

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
Three.jsはdynamic importし、RendererからEngineへ結果を返さない。通常ROLLとPenalty（Seriesは現在chunk）は、Engineが確定した配列順と値をそのまま表示する。

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

`src/storage/sessionRecovery.ts`が`sessionStorage`との境界、game/draft schema version 4の保存形式、復旧validationを担当する。`gameStore`はEngineまたはFlowが返した次のauthoritative state / draftをまずmemoryへcommitし、その直後に保存を試みてからsubscriberへ通知する。保存成否はゲームルール、Presentation、interaction unlockへ影響させない。

- ゲーム中はauthoritative `FlowState`、Setup / Replay Preparationでは現在のdraftを保存する。`visibleState`、busy、animation stage、Three.js resource、Promise、timer、RAF、AudioContextは保存しない。
- reload時は保存済みstateを`visibleState`にも設定し、busy=falseで開始する。確定済みROLL／Penaltyを再抽選せず、次の有効な操作から再開する。Series Penaltyのrunningだけは復元表示のpaint acknowledgment後fresh 1500msで次未実行chunkを自動再開する。pending loserは自動開始しない。
- プレイヤー数・ID・順序、Game Modeと固有設定・Dice Mode・ROLL上限、ダイス不変条件、得点・完走、手番、phase、累積完走数、turnId・roll番号、penaltyId・計算結果を検証する。不正値は補正せず破棄し、schema 3を含む旧game saveはmigrationなしで拒否し、mode / ROLL ∞を推測補完しない。
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
v4の最終通しプレイQA・OUT実画面目視・最終Push判断は人間が行う。追加AI最終監査を必須工程にしない。v1当時の監査は履歴資料FINAL_AUDITを参照する。

## Responsive / Final UI Polish

単一のレスポンシブUIを維持し、320pxからdesktopまで、Setup・ゲーム本編・順位・サドンデス・敗者発表・Penalty・最終結果・確認dialogが横にはみ出さない構成とする。主要ボタンと並べ替え操作は44px以上のタップ領域を持ち、端末のsafe areaはviewportとページ余白で確保する。

- 狭幅ではダイス領域の高さ、カード余白、数値表示を圧縮しつつ、5 / 7 DICEは最大個数を横1行、10 DICEは最大5列、14 DICEは最大7列で表示する。通常ROLLのSAFE / GET / OUTラベルを読める大きさにし、Presentation領域はROLL前から必要高を確保してページ高の変動を抑える。
- 順位行はrank・名前／状態・score／残りを分け、狭幅ではscore情報を次段へ送る。完走・現在手番・暫定最下位は文字と枠／背景を併用する。
- Penaltyは確定値を再計算せず、既存のBASE・MULTIPLIER・FINALを数式として読み取れる配置にする。
- reduced motion、2D fallback、Sound OFF、Recovery通知でも同じ情報と操作を維持する。

## Setup / Replay / Reset

Setupは2〜10人のparticipant行を正とし、追加・中間削除・並べ替え・名前・Game Modeと固有設定・Dice Mode 5 / 7 / 10 / 14・throwStyle・ROLL上限を編集する。IDを維持しdraft変更を保存する。「ROLL上限」のvisible optionsは∞ / 1 / 2 / 3 / 4 / 5、default∞。

Game Modeはプレイヤー設定の下にノーマル（default） / 完走指定 / 連続試合を配置する。完走指定だけ「最低完走者数」1〜5、連続試合だけ「試合数」2〜5を表示する。モード切替は完走指定target=1、連続試合gameCount=2へresetし、同一mode再選択は現在値を維持する。非選択modeのhidden設定は保持しない。完走指定はROLL∞固定でROLL上限fieldset自体を非表示にし、離れた後も以前の有限値を復活させない。

Replay Preparationは人物・ID・名前・Game Modeと固有設定・Dice Mode・throwStyle・ROLL上限を固定し、順番だけ変更して明示開始する。有限は「ROLL 3回」等、無制限は「ROLL ∞」。New Gameはこれらを引き継いだ編集可能Setup。Full Resetは確認後ノーマル・2人・空欄・初期順・7 DICE・normal・ROLL ∞へ戻り、Soundを維持する。

## ROLL counter / Turn End

有限時のみPLAYERと同じ`.player-roll-line`内の`.roll-counter`へROLL n/limitを表示する。PLAYER行を折り返さずAction位置を維持する。∞ではcounter DOMを置かない。

番号は「次に振るROLLが何投目か」。limit 3：turn startで1/3 → 1投目animation・結果演出中も1/3 → 継続可能で2/3 → 2投目演出中も2/3 → 継続可能で3/3 → 3投目演出中も3/3 → 終了後非表示。押下直後に次番号へ進めない。

Engineの終了優先順位はCOMPLETE > no-score > ROLL上限 > no-active-dice > continuation。UIはauthoritative outcome/reasonを表示する。rollLimit理由にはTURN ENDと「ROLL上限に到達しました」を既存turn-message内に表示し、no-scoreには上限メッセージを出さない。

## Dice Mode別結果カード

| Dice Mode | 全モード通常Play / ノーマル・完走指定Penalty |
| --- | --- |
| 5 / 7 DICE | 1行 |
| 10 DICE | 10→5+5、9→5+4、8→5+3、7→5+2、6→5+1、5以下→1行 |
| 14 DICE | 14→7+7、13→7+6、12→7+5、11→7+4、10→7+3、9→7+2、8→7+1、7以下→1行 |

2D結果カードとThree.js animationの物理配置は別仕様。Three.jsへ厳密7+7を要求しない。

## Penalty OUT / Recovery

通常Playと同じthrowStyleでOUT判定後、SAFEだけD6生成する。ノーマル / 完走指定のPenaltyは各敗者1回、最大14個で、通常PlayのROLL上限対象外。OUTは同じ3D場外演出・2D OUT表示を使い、6 faceに置換しない。SAFEの1/5は赤いfaceだが特殊得点なし。

式は確定配列順にOUT(6) + 2 + 5 + OUT(6) = 19等を表示し、BASE × MULTIPLIER = FINALへ進む。OUTを別集計・並べ替えしない。

Recoveryは保存した上限・ターン進行・終了理由を復元し、reload前のROLL 2/3を維持する。最終許可ROLLの終了stateも受け入れる。Penalty OUTはstatus out / value nullを復元し、再抽選・face再生成・RandomSource再消費・Penalty再ROLLをしない。

## Mobile Stable Layout契約

320x568 / 375x667 / 390x844 / 430x932で、PlayのPLAYER n/n上端〜主要Action下端、PenaltyのPENALTY n/n上端〜主要Action下端が1 viewport内に収まる。

通常ROLL・続けてROLL・Penalty ROLL前後でscroll positionを勝手に動かさず、Actionを大きく移動させず、animation/result切替でlayout shiftを起こさない。同じターン内の結果focusはpreventScrollを使用する。

reserved presentation領域はidle時にも必要高を確保する安定性のための領域で、無駄な空白として消さない。READY・animation・status・Action Slotの構造を維持する。要素削除・統合・並べ替え、status/Action Slot移動、sticky/fixed/absolute Action hack、overflow隠蔽、animation短縮で高さを稼がない。構造変更が必要なら人間判断へ戻す。reduced motion・2D fallback・Sound OFFでも同じ情報と操作を維持する。

## Three.js 14 DICE契約

Renderer最大14、15は拒否。11〜14はbalanced rowsと大個数用開始配置、狭いstageではcamera距離調整を使う。tray/dice寸法を維持し、小個数へ戻れば通常framingへ戻る。14個が自然に見えtray内で不自然にならず見切れないことが要件。

Rendererはpresentation-onlyでRandomSource非消費。SAFE face・OUT status・配列順はcommitted resultと一致する。resource再利用、resize再描画、context loss、timeout、cleanup、同じ結果の2D fallbackを維持する。

## Game Mode進捗 / Series暫定順位

PLAYERと同じ`.player-roll-line`に完走指定は「完走 current / target」、連続試合は「試合 current / total」を表示する。有限ROLL counterは連続試合でも共存する。進捗はvisibleStateを正とし、staged reveal前に新しい完走数等を先行表示しない。READY / animation / resultでreserved領域・Action位置を維持する。

ノーマル / 完走指定の暫定順位は現在Roundの終了済みTurnを従来どおり比較する。Seriesは現在Gameの終了済みTurnについて、過去Gameの累積値 + 現Gameの確定Turn分を比較する（累積score降順 → 累積remaining昇順 → exact tie、Complete優先なし）。未完了playerは未プレイ / プレイ中として順位対象外。最終playerのterminal ROLLで累積がatomic commitされた後は現Game分を二重加算しない。`RankingBoard`はvisibleStateを`calculateSeriesProvisional`へ渡す表示consumerであり、累積authorityを書き換えない。

## Series Penalty / auto coordinator

敗者のcumulativeRemainingDiceが対象（最大70）、正の個数は最大10個chunk。0個はROLL不要でBASE / FINAL 0、RNG・Rendererなし。各敗者の初回だけ「ペナルティROLL」、後続chunkは自動、次敗者は「次の敗者へ」後に新たな初回tapを必要とする。倍率は全chunkのBASE合計へtotalCompletionCount+1を一度だけ適用する。

running中は現在敗者・対象数・分割ROLL進捗・現在chunkの出目 / OUT・累計BASEを表示する。chunk BASE専用数値・小計・式末尾の小計を表示しない。内部chunk BASE計算は維持する。MULTIPLIER / FINAL値はrunning中は待機表示で、resolved後に合計BASE・倍率・ペナルティポイントを表示する。

現在chunkの2D配置は元Dice Modeとは独立に10→5+5、9→5+4、8→5+3、7→5+2、6→5+1、5以下1行。5 / 7 DICEでも10個chunkを表示でき、通常Playへこの規則を逆適用しない。Rendererには現在chunkだけを渡し、failure時も同じcommitted resultを2D表示する。

`seriesPenaltyAutoCoordinator`はcommit → save attempt → presentation → reveal / paint acknowledgment →1500ms wait → guarded next chunkを管理する。1 callbackで1 chunk。Store instance・revision・penalty / loser identity・committed chunk数を保持し、最新phase・busy・visibleStateと一致しないcallbackはRNG消費前に拒否する。timer / ack / pauseはpresentation-onlyで保存しない。

blocking confirmation OPENでtimer cancel、dialog中RNG消費・chunk commitなし、CANCELでfresh 1500ms、ACCEPTで終了して再開しない。disposeはtimer / subscriptionを解放する。復旧済みrunningは再演出 / rerollせず、復元結果のpaint acknowledgment後fresh 1500msで次未実行chunkへ進む。残りmsは復元せず追加tap不要。pending loserを自動開始しない。

Recoveryはmodeと固有設定、Seriesの試合番号・累積値・現Turn、Series Penaltyの対象敗者 / status / committedChunks / BASEを照合する。保存chunkからBASEを照合しても不一致は修復せず拒否する。確定chunk・OUT・累積値を再抽選 / 再加算しない。

## ルール説明 / Human QA

SetupヘッダーのSound左隣に「ルール説明」を配置し、最下部には置かない。`RulesScreen`はユーザー向けゲーム説明で、「戻る」で同じSetup draftへ戻る。AppのUI navigation stateとして管理し、Flow phase・game / participant stateを変更せず、Recovery write・RNG消費なし。既存各画面の説明も維持する。

Browser QAは320×568 / 375×667 / 390×844 / 430×932 / 768×1024 / 1280×900を対象とする。320×568の既存計測実績はPlay約567.81px、Normal Penalty約515.52px、Series Penalty約560.52pxで、確認環境での記録として扱い、全環境の寸法保証にはしない。最終通しプレイ・OUT実画面目視、progressの折り返し・Action / scroll安定、auto chunkの視認間隔、fallback / 途中reload、全員敗者、ルール説明からdraft復帰を人間が確認し、最終Pushを判断する。
