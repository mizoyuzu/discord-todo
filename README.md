# 📋 Discord ToDo Bot

Discord サーバーごとにタスクを管理できるToDoリストBot。

## ✨ 機能

- **タスク管理**: 追加・完了・編集・削除（ボタン＆モーダルで操作）
- **どこからでも追加**: `/add` コマンドでどのチャンネルからでもタスク追加
- **自然言語日時**: 「明日の15時」「来週月曜」→ Gemini AIが自動解析
- **サーバー別設定**: 有効フィールド・ToDoチャンネル・カテゴリを設定
- **毎朝リマインド**: 8:00 JST に当日＆期限超過タスクを通知
- **繰り返しタスク**: 毎日/毎週/毎月の繰り返し設定
- **カテゴリ**: サーバーごとに自由にカテゴリを作成
- **フィルタ＆ページネーション**: カテゴリで絞り込み、ページ切り替え

## 🚀 セットアップ

### 1. Discord Bot 作成

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. Bot タブでトークンを取得
3. OAuth2 → URL Generator で以下の権限を付与:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`
4. 生成されたURLでサーバーに招待

### 2. 環境変数設定

```bash
cp .env.example .env
```

`.env` を編集:
```
DISCORD_TOKEN=あなたのBotトークン
DISCORD_CLIENT_ID=あなたのクライアントID
GEMINI_API_KEY=あなたのGemini APIキー
```

### 3. Docker で起動

```bash
docker compose up -d --build
```

### 4. スラッシュコマンド登録（初回のみ）

```bash
docker compose exec bot node src/commands/deploy.js
```

## 📖 使い方

### コマンド

| コマンド | 説明 |
|---|---|
| `/todo` | ToDoリストを表示（ダッシュボード） |
| `/todo quick:タスク名` | クイック追加 |
| `/add name:タスク名` | どこからでもタスク追加（重要度・担当者・期限も指定可） |
| `/settings` | サーバー設定（管理者のみ） |

### 設定でできること

- **有効フィールド**: 重要度 / 期限 / 担当者 / カテゴリ / 繰り返し を ON/OFF
- **ToDoチャンネル**: リスト表示用チャンネル指定
- **リマインダーチャンネル**: 毎朝8時の通知先
- **カテゴリ管理**: 追加 / 削除

## 🏗️ ローカル開発

```bash
npm install
npm run deploy   # スラッシュコマンド登録
npm start        # Bot起動
```

## 📁 構成

```
├── src/
│   ├── index.js           # エントリポイント
│   ├── database.js        # SQLite DB
│   ├── gemini.js          # Gemini AI 日時解析
│   ├── reminder.js        # リマインダー
│   ├── commands/          # スラッシュコマンド
│   ├── handlers/          # インタラクションハンドラー
│   └── utils/             # ユーティリティ
├── data/                  # DB ファイル（自動生成）
├── Dockerfile
└── docker-compose.yml
```
