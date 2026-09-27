# Ichi-Go Game

STEP 2（プロジェクト初期化）の開発基盤です。ゲーム機能は未実装です。
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
- `src/game/`: 後続STEPの純粋なゲームエンジン用。現在は責務を記したREADMEのみ。
- `tests/`: TypeScript/JSXとReactを読み込むスモークテスト。ゲームルールのテストではありません。
- `vite.config.ts`: 開発・ビルド・Node環境テストの設定。

ゲームエンジンは後続STEPで純粋なTypeScriptとして追加します。
3D描画、サウンド、保存復旧、ゲーム操作はまだ実装していません。
依存関係は `package-lock.json` で固定し、生成物はGit管理から除外します。
