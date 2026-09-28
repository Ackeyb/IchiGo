# STEP 15 — Final Audit

## Audit result

2026-09-29、監査開始時の `main` / `faab308` を独立して監査した。
開始時はclean、`origin/main`より4コミット先。現行の `docs/SPEC.md` のみをゲーム仕様の正本として使用した。
AGENTS.md、実装進行ガイド、PLAYABLE_UI.md、Git履歴、全source・既存testsを確認した。

確認したFindingはMedium 3件、Low 1件。すべて修正済み。ゲームルールや依存ライブラリの変更はない。

## Findings

### Critical: 0件

### High: 0件

### Medium: 3件（修正済み）

1. **Recoveryが内部矛盾のある保存状態を採用する。**
   - `turn.result.player` と現在の `turn.player` / round playerの一致を検証していなかった。
     継続可能なplayerに終了済みresultを組み合わせると、復旧後に表示と進行条件が食い違い、ROLLできなくなる。
   - `careful` にOUTを含む状態を採用していた。
   - penaltyの `diceCount` は検証するが、`penaltyRoll.length` と一致しているかを検証していなかった。
     7個必要な敗者に1個分の自己整合した計算結果を保存すると、その誤ったポイントを採用した。
   - 初期状態以外のready checkpoint、以前の得点ダイス除外数と矛盾するROLL番号を受け入れていた。
   - 5本の拒否テストを修正前に失敗させ、整合性検証の追加後に成功を確認。不正データは推測修復しない。
2. **Three.jsのcleanup例外で後続の資源解放が中断する。**
   - `renderer.dispose()` の例外でcanvas除去、geometry/material/texture解放まで到達しなかった。
     外側のControllerはfallbackを継続できても、内部資源が残る。
   - 各解放を独立したbest-effort処理にし、参照を解除。二重dispose防止を維持。
   - 例外を注入する回帰テストの修正前fail／修正後passを確認。
3. **停止後の画面リサイズで3Dダイスが消える。**
   - `setSize()` が描画バッファを更新する一方、停止後はRAFがないため再描画されなかった。
   - Chromium実画面で再現。リサイズ後に既存scene/cameraを再描画する最小修正を実施。
   - 回帰テストの修正前fail／修正後pass、実ブラウザの再表示を確認。再抽選はしない。

### Low: 1件（修正済み）

1. **最終値に「ペナルティポイント」の表示がない。**
   penaltyの最終値ラベルとFINAL RESULTの見出しを仕様の用語へ変更した。計算値は変更していない。

## Specification compliance

| 対象 | コードから確認した内容 | 主なテスト |
| --- | --- | --- |
| SPEC §77 01–06 | 7個開始、1=100、5=50、複数加点、得点ダイス除外、初回0点終了、最後の1/5で完走 | engine |
| 07–17 | OUTをD6より先に判定、OUTはnull・無得点・再ROLL不可・remainingに含む・完走不可 | engine |
| 継続と終了 | activeが残り得点があれば手動で必ず継続。任意停止・自動ROLLなし。no-scoreまたはactive=0で終了 | engine / flow / playable |
| 不変条件 | active+stranded+removed=7、remaining=active+stranded。累積得点と除外数の整合性 | engine / audit |
| 18–22、30 | 完走者優先・全完走者同率1位、非完走者はscore降順／remaining昇順、OUT内訳不使用、1,2,2,4、最低rank全員敗者 | ranking |
| 暫定順位 | turnFinishedのみ、未プレイ／未終了は対象外、暫定最下位全員を強調 | ranking / playable |
| 23–28 | 全員完走または全員非完走かつscore+remaining同一でSD。全員・元の順・投げ方・累積完走数を維持。round stateを初期化。回数制限なし | suddenDeath / audit / playable |
| 29、倍率 | decisive roundを含めCOMPLETEの論理commit時に1回だけ加算。倍率は保存せずtotalCompletionCount+1から取得 | audit / engine / flow |
| 31–34 | decisive roundのremaining個、全敗者を固定順に個別1回ROLL。OUTなし、1/5は通常値、face sum×倍率 | penalty / audit / playable |
| 35–38 | rough=.03、normal=.01、careful=0、default normal。各ダイス独立の厳密な `<` 境界、carefulで0を入力してもOUTなし | engine |
| 39 | 同期busy、revision、turnId/rollNumber、penaltyIdで重複・stale操作拒否。拒否時は乱数消費なし | engine / flow / penalty / playable |
| 40 | authoritative checkpointのみsessionStorageへ保存し、復旧時のROLL再実行なし | storage / sessionRecovery UI |
| 41–42 | new gameは2人・空名・normal・初期順。replayは名前・順番・投げ方を維持し結果／完走数／SDをリセット。Sound保持 | playable / flow |
| UI操作 | 2〜10人、同名可、一意ID、trim後grapheme 1〜12文字。次プレイヤー・結果・SD開始・敗者・penalty・最終結果は明示操作 | playable |

ランキング、SD判定、倍率計算はUIから純粋なgame関数を呼び出す。UI独自の順位比較・SD条件分岐の再実装はない。
DiceViewのGET／+100／+50とpresentationDiceのscoringは表示用の分類であり、authoritative stateを更新しない。
Three.jsの姿勢・軌道は確定結果を受け取る一方向のPresentationであり、物理やanimationから結果を採用しない。

## Async / state safety

`gameStore.dispatch`の同期ロック → `advanceFlow`の結果をmemoryへcommit → `saveGame`を試行 → subscriber通知 → DicePresentation → revision指定reveal → 描画後のunlock、の順を確認。
ROLL中のvisibleStateは直前の状態を維持し、確定結果の得点・完走・倍率をアニメーション開始前にUIへ漏らさない。

| 障害・境界 | 追跡結果と証拠 |
| --- | --- |
| rapid double click / stale revision | storeでbusyとrevisionを確認。エンジンでも操作識別子を確認。既存テストで乱数消費なし |
| stale Promise | React effectのcurrent flagとcleanup、storeのrevision照合。古い完了は新状態をreveal/unlockしない |
| initialization hang / import failure | Controllerの4秒timeoutとfailure処理。同じ確定値で2Dへ。既存Controller・UIテスト |
| presentation hang / rejection | timeout／catch後にdisposeしfallback。同じ確定値を表示。既存Controller・UIテスト |
| unmount during initialization / presentation | Controllerのdisposedとeffect cleanupで旧callback無効。両ケースのUIテストを追加 |
| StrictMode | effect開始のmicrotask前に最初のcleanup。storeはReact updaterで乱数を引かない。既存テスト |
| repeated rolls / stale Group | 同一Rendererを再利用し、present冒頭のclearで前のRAFとGroupを除去 |
| reset / replay | resetでもrevisionとゲーム識別子は巻き戻さない。古いactionの拒否をテスト |
| repeated SD | 元の全員・順番・累積値の維持と複数回繰り返しを既存テストで確認 |

## Recovery safety

- sessionStorageのみ。version 1のenvelopeを使用。UI設定Soundは別キー。
- player counts、phase、手番、ID／順、完走数、turnId、ROLL番号、penaltyId／順序／結果の検証を追跡。今回上記の不整合検証を強化。
- JSON破損・schema不正・未対応versionは採用せず、削除を試みて新規setupへ。削除不可時はcleared markerへの置換を試行。
- get／provider障害はmemoryで継続。set失敗もcommitを巻き戻さず警告。remove失敗時も警告し、現在のインスタンスは旧entryを採用しない。
- reloadはauthoritative stateをvisibleStateへ設定しbusy=falseで再開。演出、Promise、timer、RAFを保存しない。
- commit後・演出前の通常ROLLは既存テスト、通常／penaltyの保存値不変は実ブラウザで確認。
- SPEC §101どおり、保存失敗後のreloadで最後の正常保存時点へ戻る可能性は許容される。

## Presentation safety

- face 1〜6は指定quaternionへ収束し、最終frameでその値を明示設定。OUTにはnumeric faceもtextureも付与しない。
- active context lossはPromise rejection→dispose→2D。実ブラウザで拡張機能からcontext lossを起こし、保存内容不変・unlock・2Dへの移行を確認。
- idle context lossは次のpresentで拒否してfallback。次ROLLまでの間も文字の確定結果は表示済み。
- RAF、ResizeObserver、context listener、GPU resourcesの破棄経路を確認。今回cleanup例外時の継続解放を修正。
- reduced motionは3D初期化と段階待機を省略し、同じ結果を提示する。
- Soundは非同期resumeをゲーム進行から待たず、生成／resume／playback／schedulingの例外を封じ込める。実WebAudioクラスへの障害注入4ケースを追加。
- Sound OFFでも文字・出目・得点・OUT・結果を表示。reload／replay／new game／SD間の設定維持を既存テストとブラウザで確認。

## Final UI compliance

具体的なOUT確率を表示せず、GET／OUT表記を維持。不要な直前ROLL見出し・除外個数説明・penalty説明なし。
最終値にペナルティポイントを表示する。
320〜430pxで7枚の結果カードが横1行。長い名前、順位、複数敗者、FINAL RESULTの横はみ出しなし。
mainの幅だけでなくdocumentのscrollWidthとviewport幅を比較した。確認したcontext-loss ROLLではdice-fieldの前後高が465.375pxで一致。
主要buttonはCSSで最低44px。native dialog、初期キャンセルfocus、Escape、openerへのfocus復帰を確認。

## Tests

- `npm test`: 16ファイル、255テスト成功。
- `npm run typecheck`: 成功。
- `npm run lint`: 成功。
- `npm run build`: 成功。既知のThree.js chunk 500 kB超warningのみ（対象外）。
- `git diff --check`: 成功。
- 7本の回帰テストは修正前fail／修正後passを確認。追加の6本はSound障害とunmount境界の不足していた検証を補う。

## Manual verification

PlaywrightでローカルViteのChromiumを操作。幅320/375/390/430/768/1280px。
通常の2人ゲーム、12文字名、3Dの複数ROLL・リサイズ、同一タブreload、Sound OFF保持を確認。
実エンジンから生成した10人・9人同率敗者のcheckpointを用い、ランキング→敗者→9回の個別penalty→FINAL RESULTをUI操作した。
reduced motion、7枚横1行、各画面の横幅、penalty reload、dialog、replay、new game、active WebGL context lossも確認。
画面確認用のPNG／CLIログは `output/playwright/` に置き、コミット対象外とした。

## Fixes made

復旧時の相互整合性検証、Three.jsリサイズ時の再描画、例外時の継続cleanup、ペナルティポイントの表示名を修正。
エンジンの得点・OUT確率・順位・SD・penalty計算は変更していない。

## Remaining risks

確認済みFindingの未修正分はない。iOS Safari／Android実機／実GPUごとの検証は未実施であり、全対象端末での完全保証ではない。
障害系の一部はモックを使った再現であり、実ブラウザで全種類のdriver・storage障害を起こしたわけではない。
sessionStorageの削除とmarker保存が両方失敗した場合、reload後の古いデータ排除は保証できない（警告付きmemory継続）。
既知のThree.js chunk warningは依頼どおり変更しない。

## Files changed

- `src/storage/sessionRecovery.ts`
- `src/dice/three/ThreeDiceRenderer.ts`
- `src/app/App.tsx`
- `tests/storage/sessionRecovery.test.ts`
- `tests/dice/threeDiceRenderer.test.ts`
- `tests/ui/dicePresentation.test.tsx`
- `tests/ui/sound.test.ts`
- `docs/FINAL_AUDIT.md`

## Commit

指定メッセージ `fix: address final audit findings` で監査修正のみをコミットする。pushは行わない。
