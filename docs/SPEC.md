# Ichi-Go Game

## Web Application Specification v2

### Codex Implementation Source of Truth

---

# 0. この文書について

本書はIchiGo v2の唯一のSource of Truthである。旧仕様、変更設計文書、実装、テストと競合する場合は本書を優先する。

現行実装はmain / 366c732でFinal Auditを完了したv1。今回の文書統合はv2実装完了を意味しない。既存の正しいEngine・Presentation・障害時継続設計を保持して段階的に拡張する。

[変更仕様書](v2_変更仕様書.md)は統合済みの設計履歴であり、第二の正本ではない。[FINAL_AUDIT.md](FINAL_AUDIT.md)はv1の監査記録として保持する。

仕様が曖昧な場合に独自のゲームルールを追加しない。以下の具体的な7個の出目・得点例は、明記がない限り7 DICEの例であり、全Modeの初期個数を7に限定しない。

---

# 1. ゲーム概要

2～10人でプレイするダイスゲーム。

各プレイヤーは選択されたDice Mode（5 / 7 / 10）個の6面ダイスから開始する。

ゲーム本編では、現在ROLL可能なダイスをすべて振る。

有効な出目について、

```text
1 = 100 points
5 = 50 points
```

とする。

1または5が出たダイスは得点化したあと除外される。

2・3・4・6のダイスは次のROLLでも使用する。

ただし、ダイスには一定確率で「OUT」が発生する。

OUTになったダイスは、

- 出目なし
- 得点なし
- 以後ROLL不可
- 1/5による正常な除外とは扱わない
- 最終的な残りダイス数には含める
- そのプレイヤーの完走を不可能にする

ものとする。

---

# 2. プレイヤー人数・Dice Mode・Setup

プレイヤーは2〜10人。人数はparticipants.length（Player row数）から派生し、独立したplayerCountを二重管理しない。

```ts
type DiceMode = 5 | 7 | 10;
const DEFAULT_DICE_MODE: DiceMode = 7;
// authoritative configurationから派生。独立した可変stateとして保存しない。
const initialDiceCount = diceMode;
```

初回Setupは2人・空欄name・初期順・7 DICE・throwStyle=normal。行追加は空欄nameで最大10人まで。各行を削除でき、中間行の削除も許可する。2人のとき削除不可。追加・削除・並べ替え後は配列順から表示順を正常化し、残ったinternal Player IDを振り直さない。IDは一意で名前や表示位置とは独立する。同名を許可する。

通常Setupでは名前・人数・順番・Dice Mode・投げ方を編集可能。開始時の名前検証は§85・97に従う。再戦準備の制限は§56に従う。

Dice Modeはゲーム全体のauthoritative configuration。現在のdice countsやその合計から推測しない。ゲーム開始後は人物・名前・順番・Dice Mode・投げ方を変更不可。Modeで変わるゲームルールは初期ダイス数だけであり、得点、OUT確率、継続、順位、倍率は共通。

---

# 3. プレイ順

プレイヤー登録後、ゲーム開始前であれば自由に並べ替え可能。

ゲーム開始後は固定。

サドンデスでも最初に決定したプレイ順を維持する。

---

# 4. 投げ方設定 / OUT確率

セットアップ画面にゲーム全体の設定として、

```text
投げ方
```

を設ける。

選択肢：

```text
乱暴    3%
普通    1%   ← DEFAULT
丁寧    0%
```

内部表現例：

```ts
type ThrowStyle = "rough" | "normal" | "careful";

const OUT_PROBABILITIES: Record<ThrowStyle, number> = {
  rough: 0.03,
  normal: 0.01,
  careful: 0,
};
```

ゲームUIでは具体的な確率値を表示せず、「乱暴」「普通」「丁寧」の名称だけを表示する。

デフォルト：

```ts
throwStyle = "normal";
```

OUT確率はDice Modeによって変えない。

この確率は**ROLL単位ではなく、ROLL対象となる各ダイス単位**で独立判定する。

---

# 5. ダイスの状態

単純な `remainingDice` だけでゲーム状態を管理してはならない。

各プレイヤーについて最低限、

```ts
activeDice
strandedDice
removedDice
```

を管理する。

意味：

```text
activeDice
= 次回ROLL可能なダイス

strandedDice
= OUTになり、以後ROLL不能だが残りダイスには含まれるダイス

removedDice
= 有効な1または5によって正常に除外されたダイス
```

常に、

```ts
activeDice + strandedDice + removedDice === initialDiceCount
```

を満たすこと。

順位判定・ペナルティ判定に使用する「残りダイス数」は、

```ts
remainingDice = activeDice + strandedDice;
```

である。

---

# 6. ターン開始

各ラウンドのターン開始時：

```ts
score = 0;
activeDice = initialDiceCount;
strandedDice = 0;
removedDice = 0;
completed = false;
turnFinished = false;
```

---

# 7. ROLL対象

ROLLする個数は常に、

```ts
activeDice
```

である。

`strandedDice` は絶対に再ROLLしない。

---

# 8. OUT判定

各 `activeDice` に対し、独立してOUT判定を行う。

概念：

```ts
isOut = random() < outProbability;
```

OUTの場合：

```ts
strandedDice += 1;
activeDice -= 1;
```

そのダイスには有効な1～6の出目を与えない。

OUTは、

```ts
value = null
```

または、

```ts
status = "out"
```

等として表現する。

OUTになったダイスを内部的に1～6としてゲーム判定に使用してはならない。

---

# 9. OUTと通常出目の判定順

ゲームロジック上の判定順は必ず、

```text
1. OUT判定
2. SAFEだったダイスだけ1～6を決定
3. 1/5を得点判定
4. 1/5を除外
5. ターン継続判定
```

とする。

概念：

```ts
for (const die of diceToRoll) {
  if (rollOutCheck(outProbability)) {
    results.push({
      status: "out",
      value: null,
    });
  } else {
    results.push({
      status: "safe",
      value: rollD6(),
    });
  }
}
```

---

# 10. 通常得点

SAFEダイスのみ得点対象。

```text
1 = 100
5 = 50
```

その他：

```text
2 = 0
3 = 0
4 = 0
6 = 0
```

OUT：

```text
OUT = 0
```

---

# 11. 複数得点

1と5が複数出た場合はすべて加算する。

例：

```text
[1, 1, 5, 5, 2, 3, 6]
```

なら、

```text
100 + 100 + 50 + 50 = 300
```

4個を正常除外する。

---

# 12. OUTを含むROLL例

例：

```text
[1] [5] [3] [6] [2] [OUT] [OUT]
```

結果：

```text
score += 150

removedDice += 2
strandedDice += 2
activeDice = 3
```

次回ROLL対象：

```text
[3] [6] [2]
```

のみ。

順位判定上の残りダイス数は、

```ts
remainingDice = activeDice + strandedDice;
```

なので、

```text
3 + 2 = 5
```

となる。

---

# 13. ROLL継続条件

ROLLを継続できる条件は、

**SAFEなダイスで有効な1または5が最低1個出たこと**

のみ。

概念：

```ts
const scoringDice =
  results.filter(
    die =>
      die.status === "safe" &&
      (die.value === 1 || die.value === 5)
  );

const hasScoringDice = scoringDice.length > 0;
```

OUTはROLL継続条件に含めない。

---

# 14. OUTのみ発生した場合

例：

```text
[2] [3] [4] [6] [OUT] [2] [3]
```

有効な1・5：

```text
0
```

したがって即ターン終了。

OUTが発生したこと自体は成功扱いしない。

このケースでは、

```text
score = 0
remainingDice = 7
strandedDice = 1
```

となる。

---

# 15. OUTと得点が同時発生した場合

例：

```text
[1] [3] [4] [6] [OUT] [2] [3]
```

有効な1があるため、

```text
score += 100
```

ROLL継続。

状態：

```text
removedDice = 1
strandedDice = 1
activeDice = 5
remainingDice = 6
```

次回ROLLは5個。

---

# 16. プレイヤーによる任意停止は禁止

プレイヤーは任意にターンを終了できない。

1または5が有効に出ており、かつ `activeDice > 0` なら、必ず次のROLLを行う。

現在の得点や暫定順位に関係なく継続する。

---

# 17. 通常ターン終了

SAFEな1または5が1個も出なかった場合、

```ts
hasScoringDice === false
```

ターン終了。

初回ROLLでも同じ。

例：

```text
[2, 2, 3, 4, 4, 6, 6]
```

なら、

```text
score = 0
remainingDice = 7
```

で終了。

救済ROLLはない。

---

# 18. 完走

完走条件：

```ts
activeDice === 0 &&
strandedDice === 0 &&
removedDice === initialDiceCount
```

簡略的には、

```ts
remainingDice === 0
```

でもよい。

完走したら、

```ts
completed = true;
```

とする。

---

# 19. OUTが存在する場合の完走

`strandedDice > 0` である限り、そのプレイヤーは完走できない。

例：

最後の2個：

```text
[5] [OUT]
```

処理：

```text
score += 50
removedDice += 1
strandedDice += 1
activeDice = 0
```

この場合、

```text
completed = false
remainingDice = 1
```

でターン終了。

次回ROLL対象が存在しないため、それ以上ROLLしない。

---

# 20. OUT発生時点での完走不能

一度でもOUTが発生した場合、そのラウンド中は、

```ts
strandedDice >= 1
```

となる。

したがって、そのプレイヤーは当該ラウンドでは完走不能。

ただし、サドンデスが開始された場合は全プレイヤーのダイス状態をリセットするため、次ラウンドでは再び完走可能。

---

# 21. 最後の1個

残り1個が `activeDice` で、

```text
[1]
```

または、

```text
[5]
```

なら完走。

一方、

```text
[OUT]
```

なら、

```text
activeDice = 0
strandedDice = 1
completed = false
remainingDice = 1
```

でターン終了。

---

# 22. 累積完走者数

プレイヤーが完走するたび、

```ts
totalCompletionCount += 1;
```

する。

この値はサドンデスでもリセットしない。

すべてのラウンドにおける完走回数を累積する。

---

# 23. ペナルティ倍率

```ts
penaltyMultiplier =
  totalCompletionCount + 1;
```

例：

```text
完走累積 0 → ×1
完走累積 1 → ×2
完走累積 2 → ×3
完走累積 3 → ×4
完走累積 9 → ×10
```

現在の、

```text
totalCompletionCount
penaltyMultiplier
```

はゲーム中常時表示する。

---

# 24. 順位判定

優先順位：

```text
1. 完走
2. score
3. remainingDice
```

完走者は非完走者より必ず上位。

完走者同士はscoreに関係なく完全同順位。

非完走者同士は、

```text
scoreが高い方が上
```

同点なら、

```text
remainingDiceが少ない方が上
```

それも同じなら完全同順位。

---

# 25. OUT内訳は順位のタイブレークに使用しない

重要：

```text
activeDice
strandedDice
```

の内訳は順位判定には使用しない。

例えば、

```text
Player A:
score = 200
activeDice = 2
strandedDice = 1
remainingDice = 3

Player B:
score = 200
activeDice = 3
strandedDice = 0
remainingDice = 3
```

なら完全同順位。

OUT数そのものは順位の追加タイブレーク条件ではない。

---

# 26. 競技順位

1224方式。

例：

```text
1位
1位
3位
4位
4位
```

順位：

```ts
rank =
  numberOfPlayersStrictlyAbove + 1;
```

---

# 27. 完走者

完走者は全員同率1位。

例：

```text
A: COMPLETE / 350
B: COMPLETE / 600
C: 800 / remaining 1
```

結果：

```text
A = 1位
B = 1位
C = 3位
```

A/Bの得点差は順位に影響しない。

---

# 28. 敗者

最終順位が最も低いプレイヤー全員を敗者とする。

同率最下位が複数なら全員敗者。

---

# 29. サドンデス条件A：全員完走

全プレイヤーが完走した場合、敗者なしとはせずサドンデス。

---

# 30. サドンデス条件B：全員完全同率

全員が非完走で、

```text
scoreが全員同じ
AND
remainingDiceが全員同じ
```

ならサドンデス。

`strandedDice` の内訳はこの判定に使用しない。

---

# 31. サドンデス

サドンデスにはoriginal players全員がoriginal orderで参加する。Dice ModeとthrowStyleを維持する。5 DICEは5個、7 DICEは7個、10 DICEは10個へリセットし、固定7へ戻さない。

前ラウンドの、

```text
score
activeDice
strandedDice
removedDice
completed
```

はすべてリセット。

```ts
score = 0;
activeDice = initialDiceCount;
strandedDice = 0;
removedDice = 0;
completed = false;
```

ただし、

```ts
totalCompletionCount
```

をゲーム進行の累積値として持ち越す。人物・元の順番・Dice Mode・throwStyleも維持する。ラウンド結果・ランキングは持ち越さない。

---

# 32. サドンデスとOUT設定

サドンデスでも、ゲーム開始時に選択した、

```ts
throwStyle
outProbability
```

をそのまま使用する。

再選択はしない。

---

# 33. 連続サドンデス

サドンデスでも、

- 全員完走
- 全員完全同率

なら再びサドンデス。

回数制限なし。

`totalCompletionCount` は増え続ける。

---

# 34. ペナルティフェーズ

敗者確定後、各敗者がペナルティロールを行う。

アプリ内では値を**ペナルティポイント**として扱う。

ペナルティダイス数：

```ts
penaltyDiceCount =
  loser.remainingDice;
```

ここで、

```ts
remainingDice =
  activeDice + strandedDice;
```

である。

decisive roundの確定remainingDiceを用いる。つまりOUTしたダイスも含まれ、10 DICEでは最大10個になる。

---

# 35. ペナルティROLLではOUTを使用しない

重要：

**OUTシステムはゲーム本編のROLLだけに適用する。**

ペナルティROLLでは、

- OUT判定なし
- 1/5特殊効果なし
- ダイス除外なし
- 再ROLLなし

通常の6面ダイスとして1回だけ振る。

---

# 36. ペナルティ計算

例：

```text
remainingDice = 4

Penalty Roll:

[1, 5, 5, 6]
```

なら、

```ts
basePenalty = 17;
```

倍率：

```ts
penaltyMultiplier =
  totalCompletionCount + 1;
```

最終値：

```ts
finalPenalty =
  basePenalty * penaltyMultiplier;
```

---

# 37. 複数敗者

同率最下位が複数いる場合、全員個別にペナルティROLLする。

共通ROLLは禁止。

順番は最初に決めたプレイ順。

---

# 38. 基本状態遷移

```text
SETUP
↓
PLAYER_TURN
↓
ROLL_READY
↓
ROLLING
↓
OUT_RESOLUTION
↓
DICE_RESULT
↓
SCORE_RESOLUTION
↓
RESULT_ANIMATION
↓
CONTINUE / TURN_END / COMPLETE
↓
NEXT_PLAYER
↓
ROUND_COMPLETE
↓
RANKING
↓
SUDDEN_DEATH or LOSER_REVEAL
↓
PENALTY_PHASE
↓
FINAL_RESULT
```

---

# 39. 暫定ランキング

ターン終了済みプレイヤーだけで暫定ランキングを表示。

未プレイ：

```text
未プレイ
```

としてランキング対象外。

暫定最下位は強調。

同率暫定最下位なら全員強調。

---

# 40. ゲーム画面のダイス表示

ゲーム本編では、

```ts
activeDice
```

個のダイスをフィールド上に表示・ROLLする。

`strandedDice` は次回ROLL対象として表示しない。

ただしプレイヤーが状況を理解できるよう、

```text
残り 4
ROLL可能 3
OUT 1
```

等の表示を行う。

---

# 41. OUT演出

OUT抽選されたダイスは、可能であれば3D演出上、

```text
フィールド外へ飛び出す
```

ように見せる。

ただし、**ゲーム結果を3D物理演算に依存させないこと。**

ゲームエンジン側でOUT判定を先に確定し、その結果に合わせて3D演出を行う。

つまり、

```text
Game Logic
→ OUT確定
→ 3D Animation
```

であり、

```text
3D Physics
→ OUT判定
```

ではない。

---

# 42. OUT演出とロジックの分離

OUTダイスを視覚的に完全にフィールド外へ飛ばせない場合でも、ゲームロジックを変更してはならない。

フォールバックとして、

- 画面端へ飛ばす
- フェードアウト
- OUT表示
- 赤枠等で強調
- OUTカウンターへ移動

などで表現してよい。

重要なのは見た目ではなく、

```ts
status === "out"
```

というゲームエンジン上の確定状態。

---

# 43. 1/5成功演出

SAFEな1または5：

1. ダイス停止
2. 1/5を強調
3. 得点表示
4. 対象ダイス除外
5. 確定済み状態の表示反映
6. 明示的な次ROLL操作を受付

OUTが同時発生した場合はOUT演出も表示する。

---

# 44. ターン終了演出

有効な1/5がなかった場合：

1. ダイス停止
2. OUTがあればOUT演出
3. NO SCORE / TURN END 等を表示
4. 最終score
5. remainingDice
6. OUT数
7. 明示的な「次へ」操作を受付

即座に画面を切り替えない。

---

# 45. 完走演出

完走時：

```text
COMPLETE!!
完走!!
```

専用演出。

完走を含む論理commit時に一度だけ加算済みのtotalCompletionCountと、新しい倍率を表示する。演出完了時には加算しない（§91）。

例：

```text
COMPLETE!!

TOTAL COMPLETE: 3

PENALTY
×4
```

---

# 46. OUT発生時の完走不能表示

初めてOUTが発生した瞬間、

```text
OUT!
完走不能
```

等、プレイヤーが状況を理解できる短い表示を行ってよい。

ただし演出が長すぎてゲームテンポを損なわないこと。

---

# 47. サウンド

以下を想定：

- dice roll
- dice collision
- scoring 1/5
- OUT
- turn end
- COMPLETE
- SUDDEN DEATH
- loser reveal
- multiplier
- penalty roll
- final penalty

常時、

```text
Sound ON / OFF
```

を切り替え可能。

振動は実装しない。

---

# 48. 操作方法

ROLLは画面上のボタンのみ。

スマートフォンのシェイク・モーションセンサーは使用しない。

---

# 49. 操作ロック

ROLL要求の妥当性確認→同期interaction lock→論理結果生成・ルール解決→authoritative state確定→保存試行→演出→同じoperation/revisionの結果表示→次の有効操作を受付、の順とする。

演出中はvisible stateとauthoritative stateを分離する。古い非同期完了を拒否し、演出完了は表示反映・unlockだけを行う。二重ROLL・二重加点・二重OUT・二重完走更新は禁止。Storage/Sound/3D障害でも確定結果を変えずfail-openとする。詳細は§91〜93・100〜103・106・109。

---

# 50. モーダル

モーダル表示中は背面操作不可。

ゲーム終了・リセット・セットアップへ戻る等では確認モーダルを表示。

例：

```text
ゲームを終了しますか？

現在のゲーム内容は失われます。

[キャンセル]
[終了する]
```

---

# 51. 敗者発表

最終ラウンド終了後：

```text
FINAL RANKING
↓
LOSER REVEAL
↓
remainingDice
↓
OUT Dice
↓
totalCompletionCount
↓
penaltyMultiplier
↓
PENALTY PHASE
```

複数敗者なら全員表示。

---

# 52. ペナルティ演出

段階表示：

```text
ROLL

[6] [4] [5] [2] [6]

↓

6 + 4 + 5 + 2 + 6

↓

BASE PENALTY
23

↓

MULTIPLIER
×3

↓

23 × 3

↓

FINAL PENALTY
69 pt
```

複数敗者なら1人ずつ処理。

---

# 53. 過去ゲーム履歴

永続保存しない。

過去ゲーム一覧・統計・戦績機能は不要。

---

# 54. セッション復旧・保存対象

同一タブ内のsessionStorageを使用し、最後に正常保存された次のいずれかを復元する。

- authoritative committed game state（設定、参加者・順番、phase、手番、dice・score、累積完走数、SD状態、確定結果、操作識別子を含む）。
- 現在のSetup / preparation draft（参加者ID・入力中name・配列順・Dice Mode・throwStyle・準備画面の種類）。

対象draftは、初回Setupの入力途中、新しいゲームで戻ったSetupと編集途中、再戦準備と並べ替え途中、full reset後のSetupのすべて。最新draftをメモリ上で確定して保存を試みる。正常保存後のreloadで前ゲームのFinal Resultへ戻してはならない。

空欄nameや編集途中など、まだSTARTできないdraftも保存・復元対象。Draft validation（保存・復元可能か）とStart validation（開始可能か）を分ける。§87・110参照。

Soundは独立したユーザー環境設定として保存する。outProbability、initialDiceCount、remainingDice等は設定・元stateから派生させる。animation、visibleState、busy、Promise、timer、RAF、GPU/audio resourceは保存しない。

---

# 55. ROLL中のリロード

ROLL途中のアニメーション状態を復元する必要はない。

状態保存はトランザクション的に行う。

安全な基本方針：

```text
確定状態保存
↓
ROLL開始
↓
乱数結果確定
↓
ゲームロジック処理
↓
新しい確定状態作成
↓
sessionStorage保存
↓
演出
```

リロード時は最後の安全な確定状態から復旧する。

二重加点・二重OUTを防止すること。

---

# 56. 同じメンバーでもう一度

Final Resultから選ぶと、即ゲーム開始せず再戦準備へ移動する。人物・internal ID・名前・Dice Mode・throwStyle・Soundを維持する。編集可能なのはplayer orderのみ。rename・add・delete・Dice Mode変更・throwStyle変更は禁止し、UIだけでなくFlowでも制限する。

準備後の明示的な開始操作で、選択した順番を次ゲームの固定順として開始する。開始時はscore、dice state、completed、turnFinished、rank、round results、penalty results、totalCompletionCount、suddenDeathCountを新規化し、倍率は累積完走数0から×1へ派生する。activeDiceは維持したDice Modeから初期化する。

準備中・並べ替え途中もdraft recovery対象。操作revision・ゲーム識別子を巻き戻して旧要求を再利用してはならない。

---

# 57. 新しいゲーム

Final Resultから選ぶと、人数・名前・internal ID・順番・Dice Mode・throwStyle・Soundを引き継いだ通常Setupへ戻る。以後rename・add・delete・reorder・Dice Mode変更・throwStyle変更を許可する。人数は行数から派生する。

前ゲームのscore・順位・OUT・完走・累積完走数・SD・Penalty結果は次ゲームへ持ち越さない。Setupへの遷移と編集draftを保存し、明示的な開始で新しい進行stateを作る。§104のfull resetとは別操作。

ゲーム途中の「ゲームを終了する」は従来どおり確認後に初期Setupへ戻る（Sound維持）。Final Resultの設定引き継ぎ操作と混同しない。戻ったSetupも保存対象。

---

# 58. 推奨Player型

```ts
type Player = {
  id: string;
  name: string;
  // 表示順はparticipants配列順から派生。IDは並べ替え・削除で変更しない。

  score: number;

  activeDice: number;
  strandedDice: number;
  removedDice: number;

  completed: boolean;
  turnFinished: boolean;

  rank?: number;

  penaltyRoll?: number[];
  basePenalty?: number;
  finalPenalty?: number;
};
```

`remainingDice` は保存してもよいが、可能なら派生値として扱う。

```ts
function getRemainingDice(player: Player): number {
  return player.activeDice + player.strandedDice;
}
```

---

# 59. 設定・Flow・Presentationの責務

概念上のゲーム設定は以下。具体的な型/API構成は既存実装へ段階的に適用する。

```ts
type GameConfiguration = Readonly<{
  diceMode: DiceMode;
  throwStyle: ThrowStyle;
}>;
```

Setup/preparation draftが編集中設定を所有し、開始後はゲームのauthoritative configurationを使用する。同じ設定をUI・Player・Storageで独立更新しない。initialDiceCount=diceMode、OUT確率はthrowStyleから導出する。

Flowはsetup、replay preparation、turn、ranking、suddenDeath、loserReveal、penalty、finishedを明示的に区別する。再戦準備は専用phase等の判別可能な状態で表現し、順番以外の編集を拒否する。

ROLL中の演出stage・interaction lock・visibleStateは確定ゲーム状態から分離する。古いrevision/operation IDによるaction・Promise完了を拒否する。Soundは独立した環境設定。Rendererにゲーム判定を移さない。

---

# 60. RollResult型

ゲーム本編ではOUTを通常の数字と混同しない。

推奨：

```ts
type SafeDieResult = {
  status: "safe";
  value: 1 | 2 | 3 | 4 | 5 | 6;
};

type OutDieResult = {
  status: "out";
  value: null;
};

type DieResult =
  | SafeDieResult
  | OutDieResult;
```

---

# 61. ROLL処理概念

```ts
function rollGameDice(
  count: number,
  outProbability: number
): DieResult[] {
  const results: DieResult[] = [];

  for (let i = 0; i < count; i++) {
    const isOut =
      Math.random() < outProbability;

    if (isOut) {
      results.push({
        status: "out",
        value: null,
      });

      continue;
    }

    const value =
      (Math.floor(Math.random() * 6) + 1) as
        1 | 2 | 3 | 4 | 5 | 6;

    results.push({
      status: "safe",
      value,
    });
  }

  return results;
}
```

実際の実装では乱数生成処理を注入可能にし、テスト可能にすること。

---

# 62. ROLL解決

概念：

```ts
function resolveRoll(
  player: Player,
  results: DieResult[]
) {
  const outCount =
    results.filter(
      die => die.status === "out"
    ).length;

  const safeResults =
    results.filter(
      (die): die is SafeDieResult =>
        die.status === "safe"
    );

  const ones =
    safeResults.filter(
      die => die.value === 1
    ).length;

  const fives =
    safeResults.filter(
      die => die.value === 5
    ).length;

  const scoringCount =
    ones + fives;

  const gainedScore =
    ones * 100 +
    fives * 50;

  player.score += gainedScore;

  player.strandedDice += outCount;
  player.removedDice += scoringCount;

  player.activeDice -=
    outCount + scoringCount;

  return {
    outCount,
    scoringCount,
    gainedScore,
    hasScoringDice:
      scoringCount > 0,
  };
}
```

---

# 63. ROLL後の判定順

ROLL解決後：

```ts
if (
  player.activeDice === 0 &&
  player.strandedDice === 0
) {
  // COMPLETE
}
else if (
  player.activeDice === 0
) {
  // OUTが残っているため非完走終了
}
else if (
  hasScoringDice
) {
  // 次ROLL
}
else {
  // TURN END
}
```

この順序を崩さないこと。

---

# 64. 順位比較

```ts
function comparePlayers(
  a: Player,
  b: Player
) {
  if (a.completed && b.completed) {
    return 0;
  }

  if (a.completed) return -1;
  if (b.completed) return 1;

  if (a.score !== b.score) {
    return b.score - a.score;
  }

  const aRemaining =
    a.activeDice + a.strandedDice;

  const bRemaining =
    b.activeDice + b.strandedDice;

  if (aRemaining !== bRemaining) {
    return aRemaining - bRemaining;
  }

  return 0;
}
```

`strandedDice` 単独で比較してはならない。

---

# 65. サドンデス判定

```ts
function shouldStartSuddenDeath(
  players: Player[]
) {
  const allCompleted =
    players.every(
      player => player.completed
    );

  if (allCompleted) {
    return true;
  }

  const allNonCompleted =
    players.every(
      player => !player.completed
    );

  if (!allNonCompleted) {
    return false;
  }

  const first = players[0];

  const firstRemaining =
    first.activeDice +
    first.strandedDice;

  return players.every(player => {
    const remaining =
      player.activeDice +
      player.strandedDice;

    return (
      player.score === first.score &&
      remaining === firstRemaining
    );
  });
}
```

---

# 66. ペナルティ計算

```ts
function calculatePenalty(
  diceResults: number[],
  totalCompletionCount: number
) {
  const basePenalty =
    diceResults.reduce(
      (sum, value) => sum + value,
      0
    );

  const multiplier =
    totalCompletionCount + 1;

  return {
    basePenalty,
    multiplier,
    finalPenalty:
      basePenalty * multiplier,
  };
}
```

---

# 67. 乱数処理の設計

ゲームロジックから `Math.random()` を直接呼び続ける構成は避けることを推奨する。

例：

```ts
interface RandomSource {
  next(): number;
}
```

OUT判定・D6判定に同じ抽象化を利用する。

これによりユニットテストで、

```text
必ずOUT
絶対OUTしない
1を返す
5を返す
複数OUT
```

などを決定論的にテストできる。

---

# 68. 3D Diceとの責務分離

ゲームエンジン：

```text
何個振るか
OUTか
有効な出目は何か
得点
除外
ターン終了
完走
```

3D Dice Renderer：

```text
どのように転がすか
どこへ飛ばすか
どう停止させるか
OUTをどう見せるか
```

ゲーム結果のSource of Truthはゲームエンジン。

3D物理演算をSource of Truthにしてはならない。

---

# 69. OUT演出同期

理想的な処理：

```text
Engine generates logical result
↓
Renderer receives logical result
↓
Renderer animates dice
↓
OUT dice visually leave field
↓
Safe dice settle
↓
Renderer reports animation complete
↓
Engine/UI reveals result
```

物理演算の都合でOUTダイスが完全に期待位置へ飛ばなくても、論理結果は変更しない。

---

# 70. UI表示

ゲーム中は最低限、

```text
現在プレイヤー

SCORE
350

残り
4

ROLL可能
3

OUT
1

累積完走
2

PENALTY
×3
```

を確認できるようにする。

---

# 71. スマートフォン優先

スマートフォンを主要ターゲットとする。

ただしPC・タブレットでもプレイ可能なレスポンシブUIとする。

スマートフォンでは特に、

- 3Dダイス領域
- ROLLボタン
- 現在プレイヤー
- SCORE
- 残り
- OUT
- 倍率

を優先表示する。

---

# 72. ゲーム履歴を保存しない

ゲーム終了後、過去ゲームを参照する機能は作らない。

統計・勝率・履歴一覧等も初期版では不要。

---

# 73. 実装禁止事項

以下は禁止。

```text
・任意ターン終了
・1/5なしでROLL継続
・OUTだけを理由にROLL継続
・OUTダイスの再ROLL
・OUTダイスへの得点付与
・OUTダイスに1～6の有効出目を付与
・OUT数を順位タイブレークに使用
・OUTダイスをremainingDiceから除外
・OUTが存在する状態でCOMPLETE
・ペナルティROLLへのOUT適用
・完走者同士をscoreで順位付け
・サドンデス時のscore持ち越し
・サドンデス時のOUT状態持ち越し
・totalCompletionCountのサドンデス時リセット
・複数敗者で共通ペナルティROLL
・ROLL中の二重入力
・モーションセンサーROLL
・振動
・過去ゲーム履歴の永続保存
```

---

# 74. Invariants

常に：

```ts
player.activeDice >= 0;
player.strandedDice >= 0;
player.removedDice >= 0;

player.activeDice <= initialDiceCount;
player.strandedDice <= initialDiceCount;
player.removedDice <= initialDiceCount;

player.activeDice +
player.strandedDice +
player.removedDice === initialDiceCount;
```

また、

```ts
remainingDice =
  activeDice + strandedDice;
```

かつ、

```ts
remainingDice >= 0 &&
remainingDice <= initialDiceCount;
```

---

# 75. COMPLETE invariant

```ts
completed === true
```

なら必ず、

```ts
activeDice === 0
strandedDice === 0
removedDice === initialDiceCount
remainingDice === 0
```

を満たす。

---

# 76. OUT invariant

```ts
strandedDice > 0
```

なら、

```ts
completed === false
```

である。

---

# 77. テスト必須ケース

最低限、以下のユニットテストを実装すること。

```text
01. 初回0点終了
02. 1のみ得点
03. 5のみ得点
04. 1/5複数
05. 最後の1で完走
06. 最後の5で完走
07. OUT 1個発生
08. OUT複数同時発生
09. OUTのみ＋得点なし → ターン終了
10. OUT＋1 → ROLL継続
11. OUT＋5 → ROLL継続
12. OUT＋1＋5 → ROLL継続
13. 最後のダイスがOUT → 非完走終了
14. 最後の2個が5＋OUT → 非完走終了
15. strandedDiceが再ROLLされない
16. OUTに得点が付かない
17. OUT数がremainingDiceに含まれる
18. OUT内訳が順位に影響しない
19. 完走者複数
20. score同点＋remaining差
21. score＋remaining完全同率
22. 同率最下位複数
23. 全員完走 → サドンデス
24. 全員完全同率 → サドンデス
25. サドンデスでOUT状態リセット
26. サドンデスでscoreリセット
27. 累積完走者数は持ち越し
28. 連続サドンデス
29. 最終ラウンド完走者も累積
30. 1224順位方式
31. ペナルティダイス数にOUT分を含む
32. ペナルティROLLではOUTなし
33. ペナルティROLLの1/5に特殊効果なし
34. 複数敗者が個別ROLL
35. OUT確率0%（丁寧ではOUTが発生しない）
36. OUT確率1%
37. OUT確率3%
38. 投げ方デフォルトが普通1%
39. ROLL二重実行防止
40. sessionStorage復旧
41. 新ゲーム設定引き継ぎとfull resetの分離
42. SAME PLAYERS再戦準備・順番のみ編集・明示開始・設定維持
```

確率テストは大量乱数による統計テストだけに依存せず、RandomSourceをモックして境界条件をテストすること。

---

# 78. 実装ディレクトリ例

```text
/src

  /game
    gameEngine.ts
    rollResolver.ts
    scoring.ts
    outSystem.ts
    ranking.ts
    suddenDeath.ts
    penalty.ts
    randomSource.ts
    types.ts

  /components
    SetupScreen
    GameScreen
    DiceStage
    RollButton
    PlayerStatus
    RankingBoard
    OutIndicator
    CompleteOverlay
    TurnEndOverlay
    SuddenDeathOverlay
    LoserReveal
    PenaltyStage
    FinalResult

  /dice
    diceRenderer
    diceAdapter
    outAnimation

  /audio
    soundManager

  /storage
    sessionState

  /tests
    gameEngine
    outSystem
    ranking
    suddenDeath
    penalty
```

---

# 79. v2実装順序

完成済みv1（main / 366c732）を拡張し、ゼロから作り直さない。詳細は[実装進行ガイド](../実装進行ガイド.md)。

0. 仕様統合・文書同期（文書のみ）
1. Dice Mode型・Engine invariant一般化（Ranking / SD / Penaltyの検証も含む）
2. Flow / Replay Preparation / New Game / Full Reset
3. Session Recovery schema v2・draft recovery・Sound schema分離
4. Setup UI
5. 2D Dice / Penalty UI / Action Slot
6. Three.jsの1/5 visual・10 DICE確認
7. Responsive / Manual QA
8. Final v2 Audit

各段階をレビュー可能な変更へ分割し、関連検証を完了する。未依頼の次段階へ進まない。commit・pushはその作業の明示的な許可に従い、最終pushも自動実行しない。

---

# 80. Codexへの重要指示

3Dダイスライブラリの都合に合わせてゲームルールを変更してはならない。

必要ならAdapterを作ること。

特にOUTについては、

```text
「物理的に本当に場外へ飛び出したか」
```

ではなく、

```text
「ゲームエンジンがOUTと判定したか」
```

を正とする。

3D表現は論理結果を表現するRendererである。

---

# 81. Definition of Done

v2実装完了時は最低限以下を満たすこと。文書統合だけでは達成扱いにしない。

```text
✓ 2～10人
✓ プレイヤー名設定
✓ プレイ順変更
✓ 5 / 7 / 10 DICE開始・デフォルト7
✓ 1 = 100
✓ 5 = 50
✓ 1/5自動除外
✓ 1/5なしでターン終了
✓ 任意停止不可

✓ 投げ方3種類
✓ 乱暴3%
✓ 普通1% DEFAULT
✓ 丁寧0%
✓ ダイス単位OUT判定
✓ 複数OUT対応
✓ OUTは出目なし
✓ OUTは得点なし
✓ OUTは再ROLL不可
✓ OUTだけではROLL継続不可
✓ OUTはremainingDiceに含む
✓ OUTがあれば完走不可
✓ ペナルティROLLではOUTなし

✓ COMPLETE
✓ 累積完走者数
✓ ペナルティ倍率
✓ 完走者同率1位
✓ score順位
✓ remainingDiceタイブレーク
✓ 1224順位
✓ 同率最下位
✓ 複数敗者

✓ 全員完走サドンデス
✓ 全員完全同率サドンデス
✓ 無制限サドンデス
✓ 全員再参加
✓ 元のプレイ順維持
✓ 累積完走数持ち越し

✓ ペナルティROLL
✓ 複数敗者個別ROLL
✓ 段階的ペナルティ表示

✓ 暫定ランキング
✓ 暫定最下位強調
✓ OUT表示
✓ COMPLETE演出
✓ TURN END演出
✓ SUDDEN DEATH演出
✓ LOSER演出
✓ FINAL PENALTY演出

✓ Sound ON/OFF
✓ 振動なし
✓ ROLLボタンのみ
✓ 操作ロック
✓ モーダル背面操作防止

✓ schema v2でgame / setup / preparation draft復旧・Sound設定保持
✓ 過去ゲーム履歴なし
✓ SAME PLAYERS再戦準備・順番のみ編集・明示開始
✓ NEW GAME設定引き継ぎ
✓ 専用full reset・Sound維持
✓ Mode別カード配置・1/5 face design・Penalty statusなし・Action Slot

✓ スマートフォン対応
✓ PC対応

✓ ゲームロジックと3D描画の分離
✓ RandomSourceをテスト可能にする
✓ 主要ゲームロジックのユニットテスト
```

---

# 82. 最終原則

実装判断に迷った場合は以下を優先する。

```text
1. ゲームルールの正確性
2. 二重処理を起こさないこと
3. ゲームエンジンと演出の分離
4. プレイヤーが現在状態を理解できること
5. スマートフォンで快適に遊べること
6. 演出の楽しさ
```

特に、

```text
OUTは「消えたダイス」ではない。

OUTは
「ゲームには残っているが、
 もう振ることができないダイス」
である。
```

この定義をゲームエンジン全体で一貫させること。

以上を満たすWEBアプリを実装すること。

---

## 83. 継続ROLLの操作

§16の「必ず次のROLLを行う」とは、プレイヤーが任意にターン終了を選択できないことを意味する。

ROLLの実行そのものは自動ではない。

継続条件を満たした場合、

```text
結果確定
↓
演出
↓
次ROLL可能状態
↓
プレイヤーがROLLボタンを押す
↓
次ROLL
```

とする。

自動ROLLは禁止する。

各ROLLは必ずプレイヤーによるROLLボタン押下を起点とする。

---

## 84. 次プレイヤーへの移行

ターン終了または完走後、次プレイヤーへ自動移行しない。

演出と結果表示完了後、

```text
次のプレイヤー
○○

[次へ]
```

等の確認UIを表示する。

プレイヤーが「次へ」を押した時点で次プレイヤーのターンへ移行する。

これにより、複数人で1台の端末を使用する場合でも、端末受け渡しや結果確認の時間を確保する。

同様に、

```text
SUDDEN DEATH
→ [開始]

LOSER REVEAL
→ [ペナルティへ]
```

のように、大きなゲームフェーズの切り替えではプレイヤー操作によって進行させる。

演出終了だけを理由に自動で次フェーズへ進めない。

---

## 85. プレイヤー名

ゲーム開始時のプレイヤー名は以下の条件とする。Setup draftでは未達の入力も保存できる（§110）。

```text
trim後 1～12文字
空欄不可
同名可
```

ゲーム開始後の名前変更は禁止する。

名前は表示用途であり、プレイヤーの内部識別には使用しない。

各プレイヤーには一意なIDを付与する。

例：

```ts
type Player = {
  id: string;
  name: string;
  // ...
};
```

ランキング、プレイ順、状態管理、保存データ等では `id` を内部識別子として使用する。

同名プレイヤーが存在してもゲーム開始を禁止しない。

---

## 86. セッション復旧範囲

セッション復旧の目的は、ゲーム中およびSetup / 再戦準備中の偶発的なページリロードから復旧することである。

復旧対象：

```text
同一タブ内でのページリロード
```

復旧対象外：

```text
タブを閉じた後
ブラウザを閉じた後
別タブ
別ブラウザ
別端末
```

v2でも `sessionStorage` を使用する。

`localStorage` 等を利用して、終了したブラウザセッションを越えて進行中ゲームを永続保存する必要はない。

過去ゲーム履歴も保存しない。

---

## 87. 保存データの検証

sessionStorageからゲーム状態を復旧する場合、保存データをそのまま信用してはならない。

最低限、

```text
保存形式
必須フィールド
プレイヤー数
GamePhase / draft kind
diceMode
activeDice
strandedDice
removedDice
score
currentPlayerIndex
totalCompletionCount
throwStyle
```

等を検証する。

特に各プレイヤーについて、

```ts
activeDice >= 0
strandedDice >= 0
removedDice >= 0

activeDice +
strandedDice +
removedDice === initialDiceCount
```

等のInvariantを確認する。

---

## 88. 保存データ破損・復旧不能

保存データが不正・破損・仕様と矛盾している場合、値を推測して修復してはならない。

例えば、

```text
activeDice = 4
strandedDice = 2
removedDice = 4
```

のように選択Dice Modeが7なのに合計10となる状態を、10 DICEとして解釈し直したり、個数を補正したりして継続してはならない。

復旧不能の場合は進行中ゲームを開始せず、

```text
ゲームデータを復旧できませんでした。

保存されたゲームデータが破損しているか、
現在のバージョンでは利用できません。

[新しいゲーム]
```

等のエラー画面を表示する。

破損した一時保存データは削除する。

---

# 89. 保存データのバージョン

ゲーム状態およびSetup / preparation draftのenvelopeはversion 2とする。

```ts
// 概念例。stateは検証可能なgame / draftの判別共用体。
type StoredSession = { version: 2; state: GameOrDraftState };
```

v1ゲームsaveをv2として推測復元しない。未対応versionは安全に拒否し、破棄を試み、新しいSetupを利用可能にする。v1 migrationは必須ではない。corrupt/unsupportedの推測修復は禁止。

Sound settingの保存形式・version管理はgame recovery schemaから論理的に分離する。Sound形式に変更がなければ、game schemaを2へ上げたことを理由に有効な既存Sound ON/OFFを破棄・初期化しない。

---

## 90. プレイヤー操作が必要な進行

以下は自動実行しない。

```text
次の通常ROLL
次プレイヤーへの移行
サドンデス開始
ペナルティフェーズ開始
```

それぞれ、対応するボタン操作を必要とする。

一方、

```text
得点計算
OUT処理
ダイス除外
完走判定
ランキング計算
累積完走数更新
ペナルティ倍率計算
```

等のゲームロジックは自動処理する。

原則：

```text
ゲームルール上の計算
= 自動

新しいROLLや大きなフェーズへの進行
= プレイヤー操作
```

とする。

---

## 91. 論理状態確定と演出の順序

ゲーム結果に関係する論理状態は、必ず演出開始前に一度だけ確定する。

対象には最低限以下を含む。

```text
ROLL結果
OUT
得点
ダイス除外
activeDice
strandedDice
removedDice
ターン継続判定
ターン終了判定
完走判定
totalCompletionCount
penaltyMultiplier
```

基本処理順：

```text
プレイヤー操作
↓
interaction lock
↓
論理ROLL結果生成
↓
ゲームルール解決
↓
次のauthoritative state確定
↓
必要であれば確定状態をsessionStorageへ保存
↓
3D / UI / Sound演出
↓
次の操作可能状態へ
↓
interaction unlock
```

演出は確定済み状態を視覚・音響的に表現するだけであり、ゲーム結果のSource of Truthではない。

§43～45および§49等に記載される演出手順中の「状態更新」「得点処理」「OUT処理」「完走数更新」等は、**確定済み論理状態の表示反映**を意味する。

演出完了時にゲームロジックを再実行してはならない。

特に、

```text
二重加点
二重OUT
二重ダイス除外
二重完走判定
totalCompletionCount二重加算
```

を禁止する。

---

## 92. 演出中のリロード

演出開始前にauthoritative stateを確定する。

Session Recovery実装後は、その確定状態をsessionStorageへ保存してから演出を開始する。

したがって演出中にリロードされた場合、

```text
演出そのもの
```

を再現する必要はない。

最後に保存された確定状態からゲーム画面を再構築する。

リロードを理由として直前のROLLを再実行してはならない。

---

## 93. sessionStorage書き込み失敗

sessionStorageへの保存に失敗した場合、ゲームそのものは停止しない。

ゲームのauthoritative stateはメモリ上で維持し、現在のゲームを継続可能とする。

ただしユーザーへ、

```text
一時保存できませんでした。

このままプレイできますが、
ページを再読み込みすると現在のゲームを
復旧できない可能性があります。
```

等の警告を表示する。

保存失敗後もゲームルール・得点・順位等を変更してはならない。

古い保存状態への意図的な巻き戻しも行わない。

保存が再度成功した場合は、最新のauthoritative stateで保存内容を更新してよい。

---

## 94. ラウンド終了時の進行

通常ラウンドまたはサドンデスラウンドで最後のプレイヤーのターンが終了した場合、自動でFINAL RANKINGへ切り替えない。

最後のターン結果を確認できる状態で、

```text
[結果を見る]
```

を表示する。

押下後、

```text
FINAL RANKING
```

へ進む。

サドンデス条件を満たしている場合は、その後SUDDEN DEATH表示へ進み、

```text
[開始]
```

によって次ラウンドを開始する。

---

## 95. 最終ランキングから敗者発表

敗者が確定している場合、

```text
FINAL RANKING

[敗者発表]
```

を表示する。

「敗者発表」押下後、

```text
LOSER REVEAL
```

へ進む。

LOSER REVEAL終了後、

```text
[ペナルティへ]
```

を表示し、押下によってPENALTY PHASEへ進む。

---

## 96. ペナルティ終了後

最後の敗者のペナルティROLLおよびFINAL PENALTY表示が完了した後、自動で最終画面へ切り替えない。

```text
[最終結果を見る]
```

を表示する。

押下後、

```text
FINAL RESULT
```

へ進む。

FINAL RESULTでは最低限、

```text
最終順位
敗者
各敗者のFINAL PENALTY
totalCompletionCount
penaltyMultiplier
```

を確認可能とする。

---

## 97. プレイヤー名の文字数判定

ゲーム開始時のプレイヤー名はtrim後、

```text
1～12文字
```

とする。

文字数は可能な限り**ユーザーから見た1文字単位（grapheme cluster）**で判定する。

絵文字や結合文字等を、不自然に複数文字として数えないことを推奨する。

Web実装では `Intl.Segmenter` 等を利用してよい。

内部プレイヤー識別には名前ではなく一意な `id` を使用する。

---

## 98. サドンデス開始時のturnFinished

サドンデス開始時、全プレイヤーについて、

```ts
turnFinished = false;
```

へリセットする。

ラウンド固有状態として、

```ts
score = 0;
activeDice = initialDiceCount;
strandedDice = 0;
removedDice = 0;
completed = false;
turnFinished = false;
```

とする。

`totalCompletionCount` はリセットしない。

---

## 99. 順位説明例の訂正

§27の非完走プレイヤー例について、7ダイス・本仕様の得点ルールとの整合性を保つため、

```text
C: 800 / remaining 1
```

ではなく、

```text
C: 600 / remaining 1
```

へ訂正する。

この訂正は順位ルールそのものを変更するものではない。

結果は引き続き、

```text
A = 1位
B = 1位
C = 3位
```

とする。

---

## 100. 進行に関する最終原則

ゲーム進行では以下を統一原則とする。

```text
ゲーム結果の計算
→ 自動

authoritative stateの確定
→ 演出前

sessionStorage保存
→ 確定後・演出前

演出
→ 確定済み状態の表現のみ

新しいROLL
→ プレイヤー操作

次プレイヤー
→ プレイヤー操作

ラウンド結果表示
→ プレイヤー操作

サドンデス開始
→ プレイヤー操作

敗者発表
→ プレイヤー操作

ペナルティ開始
→ プレイヤー操作

最終結果への移行
→ プレイヤー操作
```

UI・3D・Sound・Animationはゲームロジックを再実行してはならない。

---

## 101. Session Recoveryの保証範囲

Session Recoveryは、正常にsessionStorageへ保存できた最新のauthoritative game stateまたはSetup / preparation draftまでの復旧を提供する。

sessionStorageへの書き込みに失敗した状態について、完全な復旧は保証しない。

例：

```text id="6iwq0j"
状態A
↓
sessionStorage保存成功

ROLL

状態B確定
↓
sessionStorage保存失敗

ゲームはメモリ上の状態Bで継続
```

この状態でページがリロードされた場合、sessionStorageに残っている状態Aから復旧する可能性がある。

これはSession Recoveryの保証範囲外として許容する。

保存失敗を検知した時点で、ユーザーへ最低限、

```text id="mzhpsq"
一時保存できませんでした。

このままプレイできますが、
ページを再読み込みすると
直近のゲーム進行が失われる可能性があります。
```

等の警告を表示する。

保存失敗後の状態を別の永続ストレージへ二重保存することは必須としない。

正常保存時については、§91・92に従い二重ROLL・二重加点・二重OUT・二重完走カウントを発生させてはならない。

---

## 102. Web Storageを利用できない場合

sessionStorageへのアクセス自体が利用できない場合でも、ゲームのプレイを禁止しない。

以下のいずれかが発生した場合、

```text id="7n8c8r"
sessionStorage読み取り失敗
sessionStorage書き込み失敗
sessionStorage削除失敗
その他Web Storageアクセス失敗
```

ゲームは可能な限りメモリ上のauthoritative stateで継続する。

この場合、

```text id="g7o5ks"
Session Recovery
= 利用不可
```

として扱う。

ユーザーには、

```text id="3hvejs"
一時保存を利用できません。

ゲームは続けられますが、
ページを再読み込みすると
現在のゲームを復旧できない可能性があります。
```

等の警告を表示する。

Web Storageが利用できないことだけを理由に、ゲーム全体を利用不能にしてはならない。

---

## 103. 破損データを削除できない場合

保存データが不正または破損しているが、sessionStorageから削除できない場合でも、新しいゲームの開始を禁止しない。

破損データを復旧には使用しない。

現在のタブでは、

```text id="dr4k43"
Session Recovery無効
+
メモリ上のみで新ゲーム
```

として続行してよい。

同じ破損データを繰り返し読み込んでゲーム状態として採用してはならない。

---

# 104. すべて初期状態に戻す

通常Setupに専用操作「すべて初期状態に戻す」を設け、確認Dialogを表示する。取消はdraft・保存内容を変更せず、起点へfocusを戻す。

確定後は次のSetup draftへ戻す。

```text
Player数 = 2（行数から派生）
Player names = blank
Player order = initial
Dice Mode = 7
throwStyle = normal
```

Sound settingのみ維持する。前ゲームの進行stateや結果を持ち越さない。初期化後の空欄draftも保存・復元対象であり、単なる保存削除で代用しない。ゲーム開始時に選択設定からscore・dice state等を初期化する。

この操作は§57「新しいゲーム」と別actionとして扱う。revisionや操作識別子を巻き戻して古いactionを有効化しない。

---

## 105. サウンド設定

サウンドの初期値は、

```text id="utvhtx"
ON
```

とする。

ユーザーはいつでもSound ON / OFFを変更できる。

ユーザーが変更したSound設定は、同一タブの利用中は保持する。

したがって、

```text id="f6u2ba"
同じメンバーでもう一度
新しいゲーム
すべて初期状態に戻す
サドンデス
reload / Session Recovery
```

によってSound設定を初期値へ戻さない。

Sound設定はゲーム結果とは独立したUI設定として扱う。

音声再生に失敗した場合でもゲームを停止しない。

SoundがOFFまたは音声再生不能であっても、ゲームルール・タイミング・結果を変更してはならない。

---

## 106. 3D描画を利用できない場合

3Dダイス描画はゲーム体験上重要なPresentation Layerであるが、ゲームロジックの必須依存とはしない。

3D描画を初期化できない場合、またはプレイ中に3D描画を継続できなくなった場合は、

```text id="7db9v9"
2D Dice Fallback
```

へ切り替え、ゲームを継続可能とする。

2D表示でも最低限、

```text id="m9ec0q"
各SAFEダイスの出目
OUTダイス
得点対象の1/5
残りダイス
ROLL結果
```

を認識可能にする。

3D → 2Dへの切り替えによって、

```text id="5k0i4f"
ROLL結果
OUT結果
得点
ダイス状態
完走
順位
サドンデス
ペナルティ
```

を変更してはならない。

ゲームエンジンがSource of Truthであり、2D/3DはどちらもRendererとして扱う。

---

## 107. 対応環境の基本方針

本アプリは最新世代の主要ブラウザーを対象とする。

主要対象：

```text id="y5ojds"
iOS Safari
Android Chrome
Desktop Chrome
Desktop Edge
Desktop Safari
```

スマートフォンを主要ターゲットとする。

古いブラウザーや、必要なWeb標準機能を著しく欠く環境について完全な動作保証は要求しない。

ただし3D描画のみが利用不能な場合は、可能な限り§106の2Dフォールバックによってゲームプレイを継続可能にする。

ブラウザー固有機能の不足によってゲームルールを変更してはならない。

---

## 108. §70 表示例の訂正

§70に存在する、

```text id="1rsfz9"
350点
残り4個
ROLL可能3個
OUT1個
```

という例は、本仕様のゲーム状態として到達不能であるため訂正する。

以下とする。

```text id="8nmsw4"
300点
残り4個
ROLL可能3個
OUT1個
```

理由：

```text id="cd9n9r"
remainingDice = 4
↓
removedDice = 3

1ダイスあたりの最大得点 = 100

最大score = 300
```

この変更は表示仕様・ゲームルールを変更するものではなく、例示を到達可能な状態へ訂正するものである。

---

## 109. 保存・描画障害時の基本原則

ゲームの中核ロジックと補助機能を分離する。

```text id="ym5uwi"
Game Engine
= 必須

sessionStorage
= 復旧補助

3D Renderer
= Presentation

Sound
= Presentation
```

したがって、

```text id="z3lhsa"
sessionStorage失敗
→ ゲーム継続可能

3D失敗
→ 2Dでゲーム継続

Sound失敗
→ 無音でゲーム継続
```

を基本方針とする。

補助機能の失敗によって、確定済みゲーム結果を変更してはならない。

---

# 110. Draft validationと復旧の整合性

Draft validationは保存・復元可能な構造を検証する。2〜10行、一意な空でないID、nameが文字列であること、配列順、Dice Mode、throwStyle、準備種別を確認する。空欄や開始条件を満たさない編集中nameは、それだけでcorrupt扱いしない。Start validationは別にtrim後1〜12 grapheme等を要求する。再戦準備では保持した人物・名前・設定を変更できず、順序だけを変更する。

ゲーム復旧では全Playerの個数合計を保存されたDice Modeと照合し、ready・未プレイPlayer・初回ROLL前の逆算状態もinitialDiceCountで検証する。Turn/Game/result.playerの整合、操作ID、手番、ROLL番号、累積完走数、carefulでOUTなし、Penaltyのdecisive remaining・配列長・計算結果の検証を維持する。

メモリ上のgame/draft確定→保存試行→表示通知の順を守る。ゲームROLLはその後に演出する。復旧時は確定結果を直ちに表示し、再ROLL・再加点・再OUT・二重完走更新をしない。draft復旧で自動STARTしない。

Storageのread/write/delete失敗でもapp/gameは継続可能。警告し、最後の正常保存までだけを保証する。保存失敗後のreloadでは古い正常saveへ戻り得る。削除失敗時はmarker置換等を試み、現在のインスタンスで不正データを再採用しない。削除と置換の双方が失敗した場合のreload後の排除は保証しない。Sound障害・3D障害もゲーム結果を変更しない。

# 111. Dice Result Layout・Visual・Action Slot

結果カードの列数はDice Modeと現在表示個数から決め、表示個数だけからModeを推測しない。通常ROLLとPenalty ROLLで共通。

| Dice Mode | 結果カード |
| --- | --- |
| 5 DICE | 最大5個・1行 |
| 7 DICE | 最大7個・1行、wrap・横scrollなし |
| 10 DICE | 最大5列。10→5+5、9→5+4、8→5+3、7→5+2、6→5+1、5以下→1行 |

2D/Three.js、normal/penalty共通でface 1/5のpipまたはstarを赤にする。赤はGET状態ではなくface design。通常ROLLはGET・得点等のnon-color indicatorを維持する。PenaltyはfaceのみでSAFE/GET/OUT等の通常status labelを表示しない。内部Engine representationを表示都合で変えない。出目は読み上げ可能にする。

PenaltyのBASE / MULTIPLIER / FINALはラベルと値を各表示スクエア内で中央揃えにし、桁数変化に対応する。確定計算値の段階表示順は維持する。

Presentation領域はDice→Result/Message→Action Slotを基本に、次へ・結果を見る等の位置を安定させる。min-height等で通常フロー内に領域を予約し、長い名前や警告は自然に伸長できること。固定ページheightやabsolute positioningによる無理な固定・clippingは禁止。

320/375/390/430/768pxおよびdesktopで横overflow・clipping・overlapがなくfaceを判別できること。safe area、44px以上を基本とするtouch target、keyboard、focus management、Dialogのviewport内表示とfocus restoration、reduced motionを維持する。

Three.jsはcommitted結果のadapterを維持する。全Modeでcleanup・timeout・rejection・context loss・resize・unmount・2D fallbackを検証する。同じ結果のface/status/orderを2Dと3Dで一致させ、fallbackでRandomSourceを再消費しない。個数増加を理由にRendererを書き直したり物理から結果を決めたりしない。

# 112. コピー・v2検証・対象外

採用コピーは「ONE ROLL AT A TIME」「最後のダイスまで。」。ブランド説明に固定ダイス数を含めない。選択UIの5/7/10 DICE表示は維持する。

§77の既存ルール検証に加え、各Modeでinitial/scoring/multiple scoring/OUT/no-score/COMPLETE/invariant/Ranking/SD/Penalty/replay/new game/Recoveryを決定論的に検証する。7 DICEはv1回帰を維持する。新規テストは再戦の禁止操作、full reset、Player追加・中間削除・並べ替え・ID、draft/start validation分離、全draftのreload、unsupported v1、corrupt、Sound schema独立、10個layout、Penalty status label不在を含む。

手動QAは各Modeの通常ゲーム・OUT・COMPLETE・Penalty、10個から6個まで各カード配置、連続SD、Setup編集、再戦順序、全reset、reload、全指定幅を含む。255本のv1基準テストを出発点とし、意図された仕様変更以外を回帰させない。

v2対象外：Mode別の得点/OUT確率/Ranking/倍率変更、人数上限変更、online multiplayer、server persistence、履歴、AI player、新Dice Mode（12/15等）、Three.js library変更、大規模Renderer rewrite。
