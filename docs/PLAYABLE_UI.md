# STEP 8 — 2D Playable UI

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

`DiceView`は確定済み`DieResult[]`の表示専用。OUT／SAFE／得点・除外を文字でも区別する。
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

## 検証と範囲

- 既存205テストを維持。reveal timing・古いrevision・OUT落下軌道の5件を加えて210件。
- 決定論的RandomSourceで、2人・10人、継続、完走、暫定順位、連続サドンデス、複数敗者、個別Penalty、再プレイ／初期Setup、重複操作を検証。
- React StrictModeでも抽選が重複しないことと、キーボード操作・ダイアログのフォーカスを検証。
- Chromium実ブラウザーでSetupとROLL、ダイアログ、320／390／768／1280px幅の横はみ出しを確認。
- ブラウザー確認用の生成物は`output/playwright/`に置き、コミットしない。

豪華なAnimation、Sound、Session Recovery、Web Storage、振動・シェイク操作は未実装。
ブラウザー再読み込み時は初期Setupへ戻る。実機Safari等でのプレイテストは後続STEP 9で行う。
