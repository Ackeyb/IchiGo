# Playable UI — v1 baseline / v2 progress

main / 366c732のv1を基準に、v2 STEP 1〜4を実装済みです。以下のSTEP 8〜14はv1の接続契約と実装経緯であり、固定7・即時再戦・schema v1等は現行v2の説明ではありません。v2の唯一の正本は[SPEC](SPEC.md)、段階計画は[実装進行ガイド](../実装進行ガイド.md)です。

## Current: v1（STEP 8〜14）

## フロー

Setup → 通常ターン →「次へ」→ 次プレイヤー →「結果を見る」→ FINAL RANKING。

- 同率決着なし:「サドンデスへ」→ SUDDEN DEATH →「開始」→ 全員で新ラウンド。
- 決着あり:「敗者発表」→ LOSER REVEAL →「ペナルティへ」→ 各敗者の個別ROLL。
- 各結果を確認して「次の敗者へ」。最後は「最終結果を見る」→ FINAL RESULT。
- 最終結果から「同じメンバーでもう一度」または「新しいゲーム」。確認ダイアログを挟む。
- ゲーム中の「ゲームを終了する」も確認後に初期Setupへ戻る。

継続ROLL、次プレイヤー、サドンデス開始、ペナルティROLLは全て明示的なユーザー操作。
描画完了は操作ロックの解除だけを行い、ルール計算や次フェーズ移行は実行しない。

## 状態と接続契約

- `src/game/gameFlow.ts`: フェーズの可否確認と既存Engine呼び出し。React・DOMに依存しない。
- `src/app/gameStore.ts`: 最新のauthoritative stateを所有。Reactのrender、effect、state updater内では乱数を消費しない。
- `visibleState`は最後にreveal済みのauthoritative stateへの参照であり、ゲームルールのSource of Truthではない。ROLL commitからpresentation完了までは直前の表示だけを維持する。
- 各イベントは表示時の`revision`を保持する。古いイベントは最新状態へ適用せず、乱数も消費しない。
- 同じストア内でゲーム番号とrevisionを巻き戻さない。turnIdはゲーム番号・ラウンド番号・プレイヤーID、penaltyIdはゲーム番号から作る。
- ROLLのplayerと累積完走数は既存Engineの戻り値をそのまま同じ遷移で採用する。
  Reactで得点、残数、順位、サドンデス条件、倍率、ペナルティを再計算しない。
- 遷移開始時に同期ロックする。ダイス停止後に同じrevisionの結果をrevealし、確定状態が描画された後のフレームで解除する。ロック中は最新revisionでも次の操作を拒否。
  古い描画完了通知は解除に使わない。ダブルクリックの2回目とキーリピートも抑止する。
- Setupの人数・名前・順番・投げ方は開始後の画面から編集できない。

## 表示とアクセシビリティ

`DiceView`は確定済み`DieResult[]`の表示専用。OUT／SAFE／GETを文字でも区別する。投げ方は名称だけを表示し、具体的なOUT確率はUIへ表示しない。
直前の出目と現在ROLL可能な個数を分けて表示し、OUTを再ROLL候補に見せない。
Penaltyではハイライトを無効にして全ての出目を通常D6として表示する。
`DicePresentation`は同じ確定結果を3D Rendererへ渡し、`DiceView`を常に文字情報と2D fallbackとして維持する。

名前は`Intl.Segmenter`でgrapheme単位に検証。ラベル・入力エラー・disabled状態を付与。
画面／結果の更新後は見出しへフォーカスし、Tabで主操作へ進める。
確認ダイアログはネイティブのmodal dialogを使用し、Tab循環・Escape取消・起点へのフォーカス復帰を行う。

## STEP 11 — 3D Dice接続

依存方向はGame Engine → committed `DieResult[]` → `DicePresentationController` → `DiceRenderer`。
Three.jsはdynamic importし、RendererからEngineへ結果を返さない。通常ROLLとPenaltyは、Engineが確定した配列順と値をそのまま表示する。

- SAFEは複数回バウンドしながら指定面を上にする最終quaternionへ収束させる。OUTは数値面を持たない専用色で盤面を転がり、縁を越えて重力落下する。
- `DiceRenderer`は`initialize / present / clear / dispose`を持ち、同一request IDを重複実行しない。
- 3D完了通知は表示時のrevisionで`gameStore.reveal`へ渡し、結果描画後に`gameStore.presented`でロック解除する。古い通知では新しい結果のrevealもbusy解除もできない。
- dynamic import、WebGL初期化、presentation、timeout、context lossの失敗時は、抽選を繰り返さず同じ確定結果を2D表示する。
- `prefers-reduced-motion: reduce`ではThree.jsを初期化せず2D表示する。
- RendererはROLL間でcanvas、scene、camera、geometry、material、textureを再利用する。停止後は連続描画せず、破棄時にRAF、observer、listener、GPU resourceを解放する。

## STEP 12 — Result Animation / Sound

ダイス停止後の結果表示は`DicePresentation`が段階制御する。通常ROLLはGETダイスの強調、今回得点、結果種別の順、Penaltyはbase、multiplier、finalの順で表示し、その後に同じrevisionの`visibleState`をrevealして操作ロックを解除する。段階表示は確定済みEngine結果だけを参照し、得点・OUT・完走数・倍率を再計算しない。

- 1 / 5は出目、得点ラベル、outline、pulseで識別し、OUTには得点演出を適用しない。
- NO SCORE / TURN END、COMPLETE、Sudden Death、Loser Reveal、Penaltyの意味は文字でも表示する。
- SoundはWeb Audio APIで短い効果音を生成するPresentation専用サブシステム。初期値はONで、同じタブ内のゲーム遷移を跨いで設定を維持する。
- AudioContextの生成・resume・再生・破棄失敗はすべてfail-openとし、ゲーム進行やrevealを待たせない。
- `prefers-reduced-motion: reduce`では3Dと段階待機を省略し、確定結果を2Dとテキストで即時に提示する。

## STEP 13 — Session Recovery

`src/storage/sessionRecovery.ts`が`sessionStorage`との境界、version 1の保存形式、復旧validationを担当する。`gameStore`はEngineが返した次のauthoritative stateをまずmemoryへcommitし、その直後に保存を試みてからsubscriberへ通知する。保存成否はゲームルール、Presentation、interaction unlockへ影響させない。

- 保存するのはauthoritative `FlowState`だけであり、`visibleState`、busy、animation stage、Three.js resource、Promise、timer、RAF、AudioContextは保存しない。
- reload時は保存済みstateを`visibleState`にも設定し、busy=falseで開始する。確定済みROLL／Penaltyを再抽選せず、次の有効な操作から再開する。
- プレイヤー数・ID・固定順、ダイス不変条件、得点・完走、手番、phase、累積完走数、turnId・roll番号、penaltyId・計算結果を検証する。不正値は補正せず破棄する。
- `newGame`確定時はゲーム保存を削除する。削除失敗時はcleared markerへの置換を試み、古いゲームの復活を防ぐ。`replay`はリセット後の新しいゲームを保存する。
- Sound設定はゲームstateと別キーで保存し、reload後も同一タブ内で維持する。
- access／read／write／remove失敗時は非侵襲的な警告を表示し、memory-onlyでゲームを継続する。

## 検証と範囲

- 既存テストを維持し、reveal timing、古いrevision、OUT落下軌道、段階的な得点／Penalty表示、Sound設定とfail-openを検証する。
- 決定論的RandomSourceで、2人・10人、継続、完走、暫定順位、連続サドンデス、複数敗者、個別Penalty、再プレイ／初期Setup、重複操作を検証。
- React StrictModeでも抽選が重複しないことと、キーボード操作・ダイアログのフォーカスを検証。
- Chromium実ブラウザーでSetupとROLL、ダイアログ、320／390／768／1280px幅の横はみ出しを確認。
- ブラウザー確認用の生成物は`output/playwright/`に置き、コミットしない。

振動・シェイク操作は未実装。
v1 Final AuditではChromiumの確認を実施済み。iOS Safari / Android実機の未検証範囲はFINAL_AUDITを参照し、v2のManual QAで確認する。

## STEP 14 — Responsive / Final UI Polish

単一のレスポンシブUIを維持し、320pxからdesktopまで、Setup・ゲーム本編・順位・サドンデス・敗者発表・Penalty・最終結果・確認dialogが横にはみ出さない構成とする。主要ボタンと並べ替え操作は44px以上のタップ領域を持ち、端末のsafe areaはviewportとページ余白で確保する。

- 狭幅ではダイス領域の高さ、カード余白、数値表示を圧縮しつつ、1〜7個の結果カードを横1行に保ち、SAFE / GET / OUTラベルを読める大きさにする。Presentation領域はROLL前から必要高を確保してページ高の変動を抑える。
- 順位行はrank・名前／状態・score／残りを分け、狭幅ではscore情報を次段へ送る。完走・現在手番・暫定最下位は文字と枠／背景を併用する。
- Penaltyは確定値を再計算せず、既存のbase・multiplier・finalを数式として読み取れる配置にする。
- reduced motion、2D fallback、Sound OFF、Recovery通知でも同じ情報と操作を維持する。

## v2進捗

- STEP 1〜4実装済み。Dice Modeをauthoritative configurationとしてEngine・Ranking・SD・Penalty・Recoveryへ渡す。
- 再戦準備、新ゲーム設定引継ぎ、full reset、Setup / Replay draft recovery、独立Sound schemaを実装済み。
- 通常Setupはparticipant行を正として追加・中間削除・上下移動・名前・Dice Mode・throwStyleを編集する。既存IDを維持し、変更ごとにFlow draftを保存する。
- Replay Preparationは名前・Dice Mode・throwStyleを読み取り専用表示し、順序変更と明示的な開始だけを許可する。
- Full Resetは確認Dialogを経て2人・空欄・7 DICE・normalへ戻し、Soundを維持する。
- 結果カードは5/7 DICEで1行、10 DICEで最大5列。選択Modeと現在個数を渡す。通常とPenaltyに共通適用。
- 2D/Three.jsの1/5 pip/starを赤にするがGET判定と分離。Penaltyはstatus labelなし。BASE/MULTIPLIER/FINALを中央配置し、段階表示は維持。
- Action Slotを通常フロー内で予約。長名・警告・10個配置でもclipせず伸長可能。全指定幅、focus、Dialog、safe area、reduced motionを検証。
- Storeのrevision/gameNumberを巻き戻さず、旧action・非同期完了を拒否。commit→save→presentation、Renderer再利用、timeout/context loss/fallback、Sound fail-openを維持。

結果カード・Penalty表示・Action Slot・Three.js・最終responsive polishはSTEP 5以降で実装する。
