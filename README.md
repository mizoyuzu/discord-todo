# 📋 Discord ToDo Bot

Discord サーバーごとにタスクを管理できるToDoリストBot。

## ✨ 機能

- **自然言語タスク作成**: `/create` または `@Bot メッセージ` で自由にタスク作成
  - 例: `@ToDo Bot プリンターインク確認を来週の月曜に、担当者はAlice、重要度は高`
  - AIがタスク名・期限・担当者・重要度を自動解析
  - 担当者はDiscordメンバーリストから自動マッチング
- **確認フロー**: 作成前に内容を確認→承認/編集/キャンセル
- **全員に表示**: タスク作成時はチャンネル全体に公開
- **タスク管理**: 追加・完了・編集・削除（ボタン＆モーダルで操作）
- **サーバー別設定**: 有効フィールド・ToDoチャンネル・カテゴリを設定
- **毎朝リマインド**: 8:00 JST に当日＆期限超過タスクを通知
- **繰り返しタスク**: 毎日/毎週/毎月の繰り返し設定
- **カテゴリ**: サーバーごとに自由にカテゴリを作成
- **フィルタ＆ページネーション**: カテゴリで絞り込み、ページ切り替え

## 🚀 セットアップ

### 1. Discord Bot 作成

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. Bot タブでトークンを取得
3. **Privileged Gateway Intents** で以下を有効化:
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**
4. OAuth2 → URL Generator で以下の権限を付与:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`, `Read Message History`
5. 生成されたURLでサーバーに招待

### 2. 環境変数設定

```bash
cp .env.example .env
```

`.env` を編集:
```
DISCORD_TOKEN=あなたのBotトークン
DISCORD_CLIENT_ID=あなたのクライアントID
OPEN_ROUTER_API_KEY=あなたのOpenRouter APIキー
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
| `/create text:自由入力` | 自然言語でタスク作成（AI解析） |
| `@Bot 自由入力` | メンションで自然言語タスク作成 |
| `/todo` | ToDoリストを表示（ダッシュボード） |
| `/todo quick:タスク名` | クイック追加 |
| `/add name:タスク名` | 構造化追加（重要度・担当者・期限指定可） |
| `/settings` | サーバー設定（管理者のみ） |

### 自然言語入力例

```
@ToDo Bot プリンターインク確認を来週の月曜に、担当者はAlice、重要度は高
/create text:毎週のレポート提出 金曜日まで 繰り返し:毎週
/create text:会議室予約 明日の午後3時 緊急
```

### 設定でできること

- **有効フィールド**: 重要度 / 期限 / 担当者 / カテゴリ / 繰り返し を ON/OFF
- **ToDoチャンネル**: タスク作成時の通知先チャンネル指定
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
│   ├── index.js           # エントリポイント + @メンションハンドラ
│   ├── database.js        # SQLite DB
│   ├── llm.js             # OpenRouter AI (Llama 3.3 70B)
│   ├── reminder.js        # リマインダー
│   ├── commands/          # スラッシュコマンド
│   ├── handlers/          # インタラクションハンドラー
│   └── utils/             # ユーティリティ
├── data/                  # DB ファイル（自動生成）
├── Dockerfile
└── docker-compose.yml
```

## 🔧 技術スタック

- **Runtime**: Node.js 20
- **Discord**: discord.js v14
- **DB**: SQLite (better-sqlite3)
- **AI**: OpenRouter API (meta-llama/llama-3.3-70b-instruct:free)
- **コンテナ**: Docker Compose
