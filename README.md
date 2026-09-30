# Ichi-Go Game

Current: IchiGo v2の実装とFinal Auditは完了しています。5 / 7 / 10 DICE、Replay Preparation、設定を引き継ぐNew Game、Full Reset、Session Recovery v2、独立Sound persistenceに対応しています。2D / Three.jsのv2表示、Penalty UI、Action Slot、主要viewportのresponsive/manual QAも完了しています。

得点・OUT・順位・サドンデス・ペナルティには監査済みのPure Game Logicを使用します。Runtime / dependency maintenanceも完了し、Node.js 24 LTSを対象としています。
現行v2仕様の唯一の正本は [docs/SPEC.md](docs/SPEC.md)、開発規約は [AGENTS.md](AGENTS.md) です。[実装進行ガイド](実装進行ガイド.md)は完了済みのV2 STEP順を記録し、[v2変更設計履歴](docs/v2_変更仕様書.md)は第二の正本ではありません。

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

現行のゲームエンジンAPIとv2の接続は [src/game/README.md](src/game/README.md) を参照してください。
順位・敗者判定・ターン終了済みプレイヤーの暫定順位は `src/game/ranking.ts` に分離しています。
サドンデス判定・全員のラウンドリセットは `src/game/suddenDeath.ts` に分離しています。
敗者の個別ペナルティROLL・計算は `src/game/penalty.ts` に分離しています。
画面間の進行は `src/game/gameFlow.ts` で管理します。接続契約は [docs/PLAYABLE_UI.md](docs/PLAYABLE_UI.md) を参照してください。
再戦準備・設定を引き継ぐ新ゲーム・専用full resetを分離し、game/draft schema v2と独立したSound設定を使用します。通常SetupではPlayer追加・中間削除・並べ替え・名前・Dice Mode・throwStyleを編集でき、再戦準備では順番だけを変更できます。

[v1 Final Audit](docs/FINAL_AUDIT.md)は255テスト時点の歴史的な回帰基準です。v2 Final AuditではBlocking issue 0件、369テスト成功を確認済みです。
依存関係は `package-lock.json` で固定し、生成物はGit管理から除外します。
