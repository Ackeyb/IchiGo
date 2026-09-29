# Ichi-Go Game

Current: 完成済みv1（main / 366c732、Final Audit完了）。Three.js、2D fallback、段階演出、Sound、sessionStorage Recoveryを実装しています。

Planned: v2。5/7/10 DICE、再戦準備、設定引き継ぎ、Setup行管理、draft recovery等は仕様統合済みですが、まだ実装していません。
得点・OUT・順位・サドンデス・ペナルティには監査済みのPure Game Logicを使用します。
v2実装の唯一の正本は [docs/SPEC.md](docs/SPEC.md)、開発規約は [AGENTS.md](AGENTS.md) です。[実装進行ガイド](実装進行ガイド.md)のV2 STEP順で既存実装を拡張します。[v2変更設計履歴](docs/v2_変更仕様書.md)は第二の正本ではありません。

## 開発環境

- Node.js 22.12以上（作成時の確認環境: Node.js 24.15.0 / npm 11.12.1）
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

現行v1のゲームエンジンAPIは [src/game/README.md](src/game/README.md) を参照してください。同文書のPhase/STEP表記と7個固定APIはv1時点の説明です。後続Phase扱いの3D・演出・音・保存は現在実装済みです。今回はsrc/**変更禁止のため同文書を更新せず、v2 API実装時に同期します。
順位・敗者判定・ターン終了済みプレイヤーの暫定順位は `src/game/ranking.ts` に分離しています。
サドンデス判定・全員のラウンドリセットは `src/game/suddenDeath.ts` に分離しています。
敗者の個別ペナルティROLL・計算は `src/game/penalty.ts` に分離しています。
画面間の進行は `src/game/gameFlow.ts` で管理します。接続契約は [docs/PLAYABLE_UI.md](docs/PLAYABLE_UI.md) を参照してください。
現行v1は7個固定、確認後の即時再戦、新ゲームで空欄Setup、game schema v1（Setup draftは保存対象外）です。v2では再戦準備・設定を引き継ぐ新ゲーム・専用full resetを分離し、game/draft schema v2と独立したSound設定を使用する予定です。

[v1 Final Audit](docs/FINAL_AUDIT.md)の255テストと障害時継続設計を回帰基準にします。過去の監査はv2完了の証拠ではありません。
依存関係は `package-lock.json` で固定し、生成物はGit管理から除外します。
