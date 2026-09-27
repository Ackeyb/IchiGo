# Ichi-Go Game

STEP 2の開発基盤、Phase 1の純粋なゲームエンジン、Ranking、Sudden Death判定・リセット、STEP 6（Penalty）を実装しています。
画面は起動確認用のままで、ゲームエンジンには接続していません。
仕様の正本は [docs/SPEC.md](docs/SPEC.md)、開発規約は [AGENTS.md](AGENTS.md) です。

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
- `src/app/`: 起動確認用の最小React画面。
- `src/game/`: 通常ROLL、OUT、得点、ダイス除外、継続・終了・完走を扱う純粋なエンジン。
- `tests/game/`: 注入した乱数によるゲームエンジンの決定論的テスト。
- `tests/app.test.tsx`: TypeScript/JSXとReactを読み込むスモークテスト。
- `vite.config.ts`: 開発・ビルド・Node環境テストの設定。

ゲームエンジンのAPIと対象範囲は [src/game/README.md](src/game/README.md) を参照してください。
順位・敗者判定・ターン終了済みプレイヤーの暫定順位は `src/game/ranking.ts` に分離しています。
サドンデス判定・全員のラウンドリセットは `src/game/suddenDeath.ts` に分離しています。
敗者の個別ペナルティROLL・計算は `src/game/penalty.ts` に分離しています。
ゲームUI、3D描画、演出、サウンド、保存復旧はまだ実装していません。
依存関係は `package-lock.json` で固定し、生成物はGit管理から除外します。
