'use strict';

const Parser = require('rss-parser');
const https = require('https');

// 国別の最大件数（Claude送信前の候補数）
const COUNTRY_LIMITS = {
  '🇺🇸 US': 8,
  '🇨🇳 CN': 8,
  '🇬🇧 UK': 5,
  '🇩🇪 DE': 3,
};

const RSS_FEEDS = [
  { url: 'https://techcrunch.com/category/artificial-intelligence/feed/', country: '🇺🇸 US', lang: 'en' },
  { url: 'https://venturebeat.com/category/ai/feed/', country: '🇺🇸 US', lang: 'en' },
  { url: 'https://www.theguardian.com/technology/artificialintelligenceai/rss', country: '🇬🇧 UK', lang: 'en' },
  { url: 'https://rss.dw.com/rdf/rss-en-tech', country: '🇩🇪 DE', lang: 'en' },
  { url: 'https://36kr.com/feed', country: '🇨🇳 CN', lang: 'zh' },
  { url: 'https://www.huxiu.com/rss/0.rss', country: '🇨🇳 CN', lang: 'zh' },
];

const AI_KEYWORDS_EN = [
  'ai', 'artificial intelligence', 'machine learning', 'llm', 'gpt', 'claude',
  'gemini', 'neural', 'deep learning', 'openai', 'anthropic', 'deepmind',
  'chatgpt', 'large language model', 'generative', 'mistral', 'foundation model',
  'transformer', 'diffusion model', 'robotics', 'automation',
];

const AI_KEYWORDS_ZH = [
  'ai', '人工智能', '机器学习', '大模型', '生成式', '神经网络', 'openai',
  'chatgpt', '自动化', '大语言', '智能体', '语言模型', 'deepseek', 'llm',
  '算法', '训练', '推理', '科技', '智能', '机器人',
];

async function fetchAllNews() {
  const parser = new Parser({ timeout: 10000 });
  const allItems = [];

  for (const feed of RSS_FEEDS) {
    try {
      const result = await parser.parseURL(feed.url);
      for (const item of (result.items || []).slice(0, 30)) {
        allItems.push({
          title: (item.title || '').trim(),
          link: item.link || '',
          pubDate: item.pubDate ? new Date(item.pubDate) : new Date(0),
          country: feed.country,
          lang: feed.lang,
          snippet: (item.contentSnippet || item.summary || '').slice(0, 400),
        });
      }
      console.log(`  ✓ ${feed.country} (${new URL(feed.url).hostname}): ${result.items?.length ?? 0}件`);
    } catch (e) {
      console.warn(`  ✗ ${feed.country} (${new URL(feed.url).hostname}): ${e.message}`);
    }
  }

  return allItems;
}

function selectCandidates(items) {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // 48時間以内 + 言語別AIキーワードで粗フィルタ
  const filtered = items.filter(item => {
    if (item.pubDate < cutoff) return false;
    const text = `${item.title} ${item.snippet}`.toLowerCase();
    const keywords = item.lang === 'zh' ? AI_KEYWORDS_ZH : AI_KEYWORDS_EN;
    return keywords.some(kw => text.includes(kw));
  });

  // 新着順
  filtered.sort((a, b) => b.pubDate - a.pubDate);

  // タイトル重複除去
  const seen = new Set();
  const deduped = filtered.filter(item => {
    const key = item.title.replace(/\s+/g, '').slice(0, 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 国別上限を適用してClaude用の候補を絞る
  const countPerCountry = {};
  return deduped.filter(item => {
    const limit = COUNTRY_LIMITS[item.country] ?? 5;
    const count = countPerCountry[item.country] ?? 0;
    if (count >= limit) return false;
    countPerCountry[item.country] = count + 1;
    return true;
  });
}

async function summarizeNews(items) {
  const useAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const useOpenAI = !!process.env.OPENAI_API_KEY;

  if (!useAnthropic && !useOpenAI) {
    throw new Error('ANTHROPIC_API_KEY または OPENAI_API_KEY を設定してください');
  }

  const newsText = items.map((item, i) => {
    const langNote = item.lang === 'zh' ? '（中国語記事・要翻訳）' : '';
    return `[${i + 1}] ${item.country}${langNote}\nタイトル: ${item.title}\nURL: ${item.link}\n内容: ${item.snippet}`;
  }).join('\n\n');

  const prompt = `以下のAI・テクノロジーニュース記事を評価・要約してください。

【指示】
1. 各記事のAIテクノロジー関連度を0〜10でスコアリングし、7以上の記事のみを採用する
2. 「中国語記事・要翻訳」と書かれた記事は中国語から日本語に翻訳してタイトルと要約を作成する
3. 採用した記事を1〜2文の日本語で簡潔に要約する
4. スコアが7未満の記事は結果に含めない（件数が減っても構わない）

【返却フォーマット（JSONのみ・コードブロック不要）】
[
  {
    "title": "日本語タイトル",
    "summary": "1〜2文の日本語要約",
    "url": "元のURL",
    "country": "国旗+国名（例: 🇺🇸 US）"
  }
]

【記事一覧】
${newsText}`;

  if (useAnthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content[0].text;
    return JSON.parse(text.match(/\[[\s\S]*\]/)[0]);
  } else {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
    });
    const text = response.choices[0].message.content;
    return JSON.parse(text.match(/\[[\s\S]*\]/)[0]);
  }
}

function broadcastLineMessage(text) {
  const body = JSON.stringify({
    messages: [{ type: 'text', text }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.line.me',
      path: '/v2/bot/message/broadcast',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () =>
        res.statusCode < 300
          ? resolve()
          : reject(new Error(`LINE API ${res.statusCode}: ${data}`))
      );
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendToLine(summarized) {
  const today = new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const chunks = [];
  let current = `🤖 AIニュース ${today}\n${'─'.repeat(20)}\n全${summarized.length}件\n\n`;

  for (let i = 0; i < summarized.length; i++) {
    const { title, summary, url, country } = summarized[i];
    const entry = `${i + 1}. ${country}\n📌 ${title}\n${summary}\n🔗 ${url}\n\n`;
    if (current.length + entry.length > 4800) {
      chunks.push(current.trimEnd());
      current = entry;
    } else {
      current += entry;
    }
  }
  if (current.trim()) chunks.push(current.trimEnd());

  for (const chunk of chunks) {
    await broadcastLineMessage(chunk);
  }
  return chunks.length;
}

async function main() {
  const missing = ['LINE_CHANNEL_ACCESS_TOKEN'].filter(k => !process.env[k]);
  if (missing.length) throw new Error(`環境変数が不足しています: ${missing.join(', ')}`);

  console.log('📡 RSSフィードを取得中...');
  const allItems = await fetchAllNews();
  console.log(`   合計 ${allItems.length} 件取得`);

  const candidates = selectCandidates(allItems);
  console.log(`🔍 候補 ${candidates.length} 件（US≤8, CN≤8, UK≤5, DE≤3）`);

  if (candidates.length === 0) {
    console.log('⚠️  対象ニュースが見つかりませんでした');
    return;
  }

  console.log('✍️  関連度スコアリング・日本語要約中...');
  const summarized = await summarizeNews(candidates);
  console.log(`   関連度7以上: ${summarized.length} 件を採用`);

  if (summarized.length === 0) {
    console.log('⚠️  関連度の高い記事がありませんでした');
    return;
  }

  console.log('📲 LINEにブロードキャスト送信中...');
  const msgCount = await sendToLine(summarized);
  console.log(`✅ 完了（${msgCount}件のメッセージを送信）`);
}

main().catch(err => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});
