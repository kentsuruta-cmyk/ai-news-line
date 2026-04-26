# AI News LINE Notifier

毎朝5時に海外AIニュース（米・英・独・中）を日本語でまとめてLINEに送るツールです。  
GitHub Actionsで自動実行されるため、サーバー不要・無料で使えます。

---

## 届くメッセージのイメージ

```
🤖 AIニュース 2026年4月26日
────────────────────
全12件

1. 🇺🇸 US
📌 OpenAIが新モデルを発表
GPT-5が発表され、前モデルより推論能力が大幅に向上したと報告された。
🔗 https://techcrunch.com/...

2. 🇬🇧 UK
📌 英国政府がAI規制法を可決
...
```

---

## 必要なもの

| 項目 | 取得場所 | 費用 |
|------|----------|------|
| GitHubアカウント | https://github.com | 無料 |
| LINE Messaging API | LINE Developers | 無料（月1000通まで） |
| AnthropicまたはOpenAI APIキー | 各サービス | 従量課金（月数十円〜） |

---

## セットアップ手順

### ステップ1：LINE Messaging APIの設定

1. [LINE Developers](https://developers.line.biz/) にLINEアカウントでログイン
2. 「新規プロバイダー作成」→ 名前を入力（例：`MyNotifier`）
3. 「チャネルを作成」→「Messaging API」を選択
4. チャネル名・説明を入力して作成
5. 作成後、「Messaging API設定」タブを開く
6. 「チャネルアクセストークン（長期）」の「発行」ボタンをクリック → **コピーして保存**
7. **自分のLINE User IDを確認する方法：**
   - 「チャネル基本設定」タブの「あなたのユーザーID」欄に表示されている → **コピーして保存**

> ⚠️ 「応答メッセージ」と「あいさつメッセージ」はLINE Official Account Managerでオフにしておくと通知がすっきりします。

---

### ステップ2：GitHubリポジトリの準備

1. このフォルダをGitHubにプッシュ（または[テンプレートからリポジトリを作成](https://github.com)）
2. リポジトリページの「Settings」→「Secrets and variables」→「Actions」を開く
3. 「New repository secret」で以下を追加：

| シークレット名 | 値 |
|---------------|-----|
| `LINE_CHANNEL_ACCESS_TOKEN` | ステップ1でコピーしたトークン |
| `LINE_USER_ID` | ステップ1でコピーしたユーザーID |
| `ANTHROPIC_API_KEY` | AnthropicのAPIキー（※どちらか一方でOK） |
| `OPENAI_API_KEY` | OpenAIのAPIキー（※どちらか一方でOK） |

---

### ステップ3：動作確認（手動実行）

1. GitHubのリポジトリページ →「Actions」タブを開く
2. 左メニューの「Daily AI News」をクリック
3. 「Run workflow」ボタン →「Run workflow」で即時実行
4. 数分後にLINEに通知が届けばセットアップ完了です！

---

### ステップ4：自動実行の確認

`.github/workflows/daily-news.yml` に以下のスケジュールが設定済みです：

```
毎日 05:00 JST（日本標準時）
```

以降は毎朝自動で送信されます。

---

## ローカルでのテスト方法

```bash
# 1. 依存パッケージをインストール
npm install

# 2. 環境変数を設定（.envファイルは使わず直接指定）
export LINE_CHANNEL_ACCESS_TOKEN=your_token
export LINE_USER_ID=your_user_id
export ANTHROPIC_API_KEY=your_key   # または OPENAI_API_KEY

# 3. 実行
npm start
```

---

## ニュースソース

| 国 | ソース |
|----|--------|
| 🇺🇸 US | TechCrunch AI、VentureBeat AI |
| 🇬🇧 UK | The Guardian AI |
| 🇩🇪 DE | Deutsche Welle Tech |
| 🇨🇳 CN | South China Morning Post Tech |

過去48時間以内の記事からAI関連キーワードで絞り込み、最大20件を要約します。

---

## よくある質問

**Q. LINEに届かない**  
→ GitHub Actionsのログ（Actionsタブ→該当のワークフロー）でエラーを確認してください。

**Q. 要約の精度を上げたい**  
→ `src/index.js` の `model` を `claude-sonnet-4-6`（Anthropic）や `gpt-4o`（OpenAI）に変更してください。コストは上がります。

**Q. 通知時間を変えたい**  
→ `.github/workflows/daily-news.yml` の `cron` を変更してください。  
例：毎朝7時JST = `0 22 * * *`（UTC）
