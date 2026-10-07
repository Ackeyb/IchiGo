# Ichi-Go Game

Current: IchiGo v4機能は実装済みです（実装基準: main / d7a5b3d）。ノーマル・完走指定・連続試合の3 Game Mode、連続試合の累積順位と自動分割Penalty、ルール説明に対応しています。最終通しプレイQA・OUT実画面目視確認・最終Push判断は人間の残件です。5 / 7 / 10 / 14 DICE、通常PlayとPenaltyのOUT、ROLL上限（∞ / 1〜5、完走指定は∞固定）、Replay Preparation、設定を引き継ぐNew Game、Full Resetに対応しています。同一タブのSession Recoveryと独立Sound設定、Three.js表示と同じ確定結果の2D fallbackを備えます。

得点・OUT・順位・サドンデス・ペナルティには監査済みのPure Game Logicを使用します。Runtime / dependency maintenanceも完了し、Node.js 24 LTSを対象としています。
現行仕様の唯一の正本は [docs/SPEC.md](docs/SPEC.md)、開発規約は [AGENTS.md](AGENTS.md) です。[実装進行ガイド](実装進行ガイド.md)は現在の保守フローと過去STEP記録、[v4変更仕様書](docs/v4_変更仕様書.md)・[v3変更仕様書](docs/v3_変更仕様書.md)は設計・変更履歴です。

## 開発環境

- Node.js 24 LTS（確認環境: Node.js 24.15.0 / npm 11.12.1）
- React / TypeScript（strict）/ Vite
- Vitest（Node環境）/ ESLint

```sh
npm ci
npm run dev
```

## コマンド

| コマンド | 用途 |
| --- | --- |
| `npm test` | テストを1回実行 |
| `npm run test:watch` | テストを監視実行 |
| `npm run lint` | 警告も失敗として静的検証 |
| `npm run typecheck` | ソース・テスト・Vite設定の型検証 |
| `npm run build` | 型検証後にproduction build（`dist/`） |
| `npm run preview` | ビルド結果をローカル配信 |
| `npm run check` | test・lint・typecheck・buildを一括実行 |

## 構成とスコープ

- `src/main.tsx`: ブラウザーの起動処理。
- `src/app/`: Setup、2Dダイス、ゲーム進行、順位・結果のReact画面と操作ロックを持つストア。
- `src/game/`: 通常ROLL、OUT、得点、ダイス除外、継続・終了・完走を扱う純粋なエンジン。
- `tests/game/`: 注入した乱数によるゲームエンジンの決定論的テスト。
- `tests/ui/`: jsdomとTesting LibraryによるSetup・プレイ・再プレイ・重複操作・キーボード操作のテスト。
- `tests/app.test.tsx`: TypeScript/JSXとReactを読み込むスモークテスト。
- `vite.config.ts`: 開発・ビルド・Node環境テストの設定。

ゲームルール・状態契約は [docs/SPEC.md](docs/SPEC.md)、現行APIは `src/game/` の各モジュールを参照してください。
ノーマル / 完走指定の順位は `src/game/ranking.ts`、Seriesの累積最終順位・暫定順位は `seriesRanking.ts`・`seriesProvisional.ts` に分離しています。
サドンデス判定・全員のラウンドリセットは `src/game/suddenDeath.ts`、完走指定のRound終了方針は `roundPolicy.ts` に分離しています。
敗者のsingle-roll Penaltyは `src/game/penalty.ts`、Seriesの最大70個を10個以下に分ける処理は `seriesPenalty.ts` に分離しています。
画面間の進行は `src/game/gameFlow.ts` で管理します。接続契約は [docs/PLAYABLE_UI.md](docs/PLAYABLE_UI.md) を参照してください。
再戦準備・設定を引き継ぐ新ゲーム・専用full resetを分離し、game/draft schema 4と独立したSound設定を使用します。通常SetupではPlayer追加・中間削除・並べ替え・名前・Game Modeと固有設定・Dice Mode・throwStyle・ROLL上限を編集でき、再戦準備では順番だけを変更できます。

[v1 Final Audit](docs/FINAL_AUDIT.md)は歴史的な回帰記録です。v4自動検証の基準は882 tests passed、typecheck・lint・build成功です。最終Human QAとPushは別工程です。
依存関係は `package-lock.json` で固定し、生成物はGit管理から除外します。
